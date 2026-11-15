import type { SiteData } from '../data/contract.ts'
import { J_PER_WH, SOLAR_CONSTANT_W_M2, clearSkyPanelPowerW, simulateBattery } from './energy.ts'
import type { PanelSettings } from './energy.ts'
import { intersectWindows, longestGapS, marginSeries, sunDiskFraction, totalDurationS, windowsFromMargins } from './visibility.ts'
import type { VisibilityWindow } from './visibility.ts'

/** Mission and hardware settings shared by every scenario being compared. */
export interface MissionSettings extends PanelSettings {
  /** 1–30 days. */
  durationDays: number
  batteryCapacityWh: number
  /** State of charge at the start, 0–1. */
  initialSocFraction: number
  /** Level the battery should never drop below, 0–1. */
  reserveFraction: number
  chargeEfficiency: number
  dischargeEfficiency: number
  /** Demand at all times. */
  baseLoadW: number
  /** Extra demand while Earth is in view (communication). */
  commLoadW: number
  /** Longest Earth-view outage the mission accepts. */
  maxEarthOutageH: number
  /**
   * How terrain blocking scales panel output. `centre` (default): all or nothing on the Sun's
   * centre. `partial`: by the share of the solar disk above the horizon (contract's linear
   * approximation). Visibility windows always use the centre.
   */
  sunDiskModel?: SunDiskModel
}

export type SunDiskModel = 'centre' | 'partial'

/** "Example mission hardware" defaults from the plan — assumptions, not a real lander. */
export const DEFAULT_SETTINGS: MissionSettings = {
  durationDays: 7,
  panelAreaM2: 2,
  panelEfficiency: 0.25,
  systemFactor: 0.8,
  panelMode: 'tracking',
  fixedNormalAzDeg: 0,
  fixedNormalElDeg: 0,
  batteryCapacityWh: 5000,
  initialSocFraction: 0.8,
  reserveFraction: 0.2,
  chargeEfficiency: 0.9,
  dischargeEfficiency: 0.9,
  baseLoadW: 200,
  commLoadW: 100,
  maxEarthOutageH: 6,
  sunDiskModel: 'centre',
}

export const MAX_SCENARIOS = 3
export const MIN_DURATION_DAYS = 1
export const MAX_DURATION_DAYS = 30

/** Thrown when settings are outside their physical or planned range. */
export class SettingsError extends RangeError {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(issues.join(' '))
    this.issues = issues
  }
}

/**
 * Problems with the settings, as plain English sentences for the UI; empty when the settings
 * can be simulated. The engine refuses settings with problems instead of silently clamping.
 */
export function validateSettings(s: MissionSettings): string[] {
  const issues: string[] = []
  const finite = (v: number) => Number.isFinite(v)
  const between = (v: number, lo: number, hi: number) => finite(v) && v >= lo && v <= hi
  if (!between(s.durationDays, MIN_DURATION_DAYS, MAX_DURATION_DAYS)) issues.push(`Mission duration must be ${MIN_DURATION_DAYS}–${MAX_DURATION_DAYS} days.`)
  if (!(finite(s.panelAreaM2) && s.panelAreaM2 >= 0)) issues.push('Panel area must be zero or more.')
  if (!between(s.panelEfficiency, 0, 1)) issues.push('Panel efficiency must be 0–100 %.')
  if (!between(s.systemFactor, 0, 1)) issues.push('System factor must be 0–100 %.')
  if (s.panelMode !== 'tracking' && s.panelMode !== 'fixed') issues.push('Panel mode must be tracking or fixed.')
  if (s.panelMode === 'fixed' && !(finite(s.fixedNormalAzDeg) && between(s.fixedNormalElDeg, -90, 90))) issues.push('Fixed panel direction needs an azimuth and an elevation of −90° to 90°.')
  if (!(finite(s.batteryCapacityWh) && s.batteryCapacityWh > 0)) issues.push('Battery capacity must be more than zero.')
  if (!between(s.initialSocFraction, 0, 1)) issues.push('Initial charge must be 0–100 %.')
  if (!between(s.reserveFraction, 0, 1)) issues.push('Battery reserve must be 0–100 %.')
  if (!(finite(s.chargeEfficiency) && s.chargeEfficiency > 0 && s.chargeEfficiency <= 1)) issues.push('Charge efficiency must be above 0 and at most 100 %.')
  if (!(finite(s.dischargeEfficiency) && s.dischargeEfficiency > 0 && s.dischargeEfficiency <= 1)) issues.push('Discharge efficiency must be above 0 and at most 100 %.')
  if (!(finite(s.baseLoadW) && s.baseLoadW >= 0)) issues.push('Base load must be zero or more.')
  if (!(finite(s.commLoadW) && s.commLoadW >= 0)) issues.push('Communication load must be zero or more.')
  if (!(finite(s.maxEarthOutageH) && s.maxEarthOutageH >= 0)) issues.push('Accepted Earth outage must be zero or more.')
  if (s.sunDiskModel !== undefined && s.sunDiskModel !== 'centre' && s.sunDiskModel !== 'partial') issues.push('Sun disk model must be centre or partial.')
  return issues
}

/** UTC instant of sample `k` of a scenario (ISO-8601, `Z`). */
export function sampleUtc(result: Pick<ScenarioResult, 'alignedStartUtc' | 'stepS'>, k: number): string {
  return new Date(Date.parse(result.alignedStartUtc) + k * result.stepS * 1000).toISOString().replace('.000Z', 'Z')
}

export interface ScenarioCandidate {
  siteId: string
  startUtc: string
}

export interface ScenarioSummary {
  /** Share of the mission with the body's centre above the terrain horizon, 0–1. */
  sunVisibleFraction: number
  earthVisibleFraction: number
  bothVisibleFraction: number
  longestSunOutageS: number
  longestEarthOutageS: number
  energyGeneratedJ: number
  energyDemandJ: number
  /** Demand that could not be served. */
  unmetEnergyJ: number
  /** Generation that could not be used or stored. */
  curtailedEnergyJ: number
  minSocFraction: number
  finalSocFraction: number
  /** Seconds from mission start to the first time the battery is below its reserve, or `null`. */
  firstReserveViolationS: number | null
  /** The two plain conditions the comparison reports — no hidden weights, no single score. */
  keepsBatteryReserve: boolean
  earthOutageWithinLimit: boolean
}

export interface ScenarioResult extends ScenarioCandidate {
  /** Index of the mission's first sample in the site's ephemeris; positions are read from there. */
  startIndex: number
  /**
   * UTC of that first sample. Equals `startUtc` when the requested start lies on the 10-minute
   * grid; otherwise the nearest sample is used and this says which one.
   */
  alignedStartUtc: string
  stepS: number
  /** Samples in the mission, including the last instant (steps + 1). */
  count: number
  durationS: number
  /** Per sample: centre above the terrain horizon. */
  sunVisible: boolean[]
  earthVisible: boolean[]
  sunWindows: VisibilityWindow[]
  earthWindows: VisibilityWindow[]
  bothWindows: VisibilityWindow[]
  /** Per sample: panel output and demand at that instant. */
  generationW: Float64Array
  loadW: Float64Array
  /** Per sample: battery state of charge. */
  socJ: Float64Array
  batteryCapacityJ: number
  summary: ScenarioSummary
  /** Per sample: share of the solar disk above the terrain horizon (contract approximation), 0–1. */
  sunDiskFraction: Float64Array
  model: {
    ephemerisSource: string
    solarConstantWm2: number
    sunDiskModel: SunDiskModel
    notes: string[]
  }
}

const MODEL_NOTES: Record<SunDiskModel, string[]> = {
  centre: [
    'Sun and Earth count as visible when their centre is above the terrain horizon; partial discs are not modelled.',
    'Eclipses and temperature effects are not modelled.',
    'Earth view is line of sight only: no ground-station, antenna or link-budget claim.',
  ],
  partial: [
    'Sun and Earth count as visible when their centre is above the terrain horizon.',
    'Panel output is scaled by the share of the solar disk above the horizon (linear approximation, no limb darkening).',
    'Eclipses and temperature effects are not modelled.',
    'Earth view is line of sight only: no ground-station, antenna or link-budget claim.',
  ],
}

/** Thrown when a mission does not fit inside the pre-computed data. */
export class CoverageError extends RangeError {}

/** Thrown when the data a mission needs has a missing, non-finite or impossible value. */
export class DataError extends RangeError {}

function assertMissionData(data: SiteData, startIndex: number, count: number) {
  const { ephemeris, horizon } = data
  if (!horizon.elevDeg.every(Number.isFinite) || !(horizon.azStepDeg > 0)) throw new DataError(`${data.site.id}: the terrain horizon has a missing or non-finite value.`)
  for (const body of ['sun', 'earth'] as const) {
    const s = ephemeris[body]
    for (let i = startIndex; i < startIndex + count; i++) {
      if (!Number.isFinite(s.azDeg[i]) || !Number.isFinite(s.elDeg[i]) || !(s.distanceM[i] > 0)) {
        throw new DataError(`${data.site.id}: ${body} position at sample ${i} is missing or invalid.`)
      }
    }
  }
}

/**
 * Runs one scenario: where the Sun and Earth are over the mission, when terrain hides them,
 * what the panel produces and how the battery fares. Pure: same inputs, same result.
 */
export function evaluateScenario(data: SiteData, startUtc: string, settings: MissionSettings): ScenarioResult {
  const issues = validateSettings(settings)
  if (issues.length > 0) throw new SettingsError(issues)
  const { ephemeris, horizon } = data
  const stepS = ephemeris.stepS
  const offsetS = (Date.parse(startUtc) - Date.parse(ephemeris.startUtc)) / 1000
  if (!Number.isFinite(offsetS)) throw new CoverageError(`Invalid start time: ${startUtc}`)
  const startIndex = Math.round(offsetS / stepS)
  const steps = Math.round((settings.durationDays * 86400) / stepS)
  const count = steps + 1
  if (startIndex < 0 || steps < 1 || startIndex + steps > ephemeris.count - 1) {
    const end = new Date(Date.parse(ephemeris.startUtc) + (ephemeris.count - 1) * stepS * 1000).toISOString().slice(0, 16)
    throw new CoverageError(`The mission must lie within the computed period (${ephemeris.startUtc.slice(0, 16)} to ${end} UTC).`)
  }

  assertMissionData(data, startIndex, count)
  const sunMargin = marginSeries(ephemeris.sun, horizon, startIndex, count)
  const earthMargin = marginSeries(ephemeris.earth, horizon, startIndex, count)
  const sunWindows = windowsFromMargins(sunMargin, stepS)
  const earthWindows = windowsFromMargins(earthMargin, stepS)
  const bothWindows = intersectWindows(sunWindows, earthWindows)
  const diskModel: SunDiskModel = settings.sunDiskModel ?? 'centre'

  // Instantaneous values at every sample (for the 3D view and the charts).
  const clearW = new Float64Array(count)
  const generationW = new Float64Array(count)
  const loadW = new Float64Array(count)
  const diskFraction = new Float64Array(count)
  const sunVisible: boolean[] = []
  const earthVisible: boolean[] = []
  for (let k = 0; k < count; k++) {
    const i = startIndex + k
    sunVisible.push(sunMargin[k] > 0)
    earthVisible.push(earthMargin[k] > 0)
    diskFraction[k] = sunDiskFraction(sunMargin[k], ephemeris.sun.distanceM[i])
    clearW[k] = clearSkyPanelPowerW(settings, ephemeris.sun.azDeg[i], ephemeris.sun.elDeg[i], ephemeris.sun.distanceM[i])
    generationW[k] = diskModel === 'partial' ? clearW[k] * diskFraction[k] : sunVisible[k] ? clearW[k] : 0
    loadW[k] = settings.baseLoadW + (earthVisible[k] ? settings.commLoadW : 0)
  }

  // Energy per step. `centre`: mean clear-sky power times the part of the step the Sun's
  // centre was up. `partial`: trapezoid of the disk-weighted power at the two samples.
  // The communication load runs for the part of the step Earth was up.
  //
  // The battery runs on sub-intervals cut at the Sun and Earth crossings inside a step, in time
  // order, so demand before a sunrise is not paid for by generation after it (and the comm load
  // starts at Earthrise). Steps without a crossing are one interval, as before; the energy
  // totals are the same either way.
  const subGenJ: number[] = []
  const subDemJ: number[] = []
  const subEndS: number[] = []
  const stepEnd = new Int32Array(steps)
  let energyGeneratedJ = 0
  let energyDemandJ = 0
  const crossAt = (a: number, b: number) => (a > 0 === b > 0 ? null : a / (a - b))
  const upAt = (a: number, f: number | null, t: number) => (f === null ? a > 0 : a > 0 ? t < f : t > f)
  for (let k = 0; k < steps; k++) {
    const fs = crossAt(sunMargin[k], sunMargin[k + 1])
    const fe = crossAt(earthMargin[k], earthMargin[k + 1])
    const cuts = [0, 1]
    for (const f of [fs, fe]) if (f !== null && f > 0 && f < 1 && !cuts.includes(f)) cuts.push(f)
    cuts.sort((x, y) => x - y)
    const meanClearW = 0.5 * (clearW[k] + clearW[k + 1])
    for (let c = 0; c < cuts.length - 1; c++) {
      const u = cuts[c]
      const v = cuts[c + 1]
      const mid = 0.5 * (u + v)
      let g: number
      if (diskModel === 'partial') {
        const w = (t: number) => generationW[k] + (generationW[k + 1] - generationW[k]) * t
        g = 0.5 * (w(u) + w(v)) * (v - u) * stepS
      } else {
        g = upAt(sunMargin[k], fs, mid) ? meanClearW * (v - u) * stepS : 0
      }
      const d = (settings.baseLoadW + (upAt(earthMargin[k], fe, mid) ? settings.commLoadW : 0)) * (v - u) * stepS
      subGenJ.push(g)
      subDemJ.push(d)
      subEndS.push((k + v) * stepS)
      energyGeneratedJ += g
      energyDemandJ += d
    }
    stepEnd[k] = subGenJ.length
  }

  const batteryCapacityJ = settings.batteryCapacityWh * J_PER_WH
  const sub = simulateBattery(subGenJ, subDemJ, {
    capacityJ: batteryCapacityJ,
    initialJ: batteryCapacityJ * settings.initialSocFraction,
    reserveJ: batteryCapacityJ * settings.reserveFraction,
    chargeEfficiency: settings.chargeEfficiency,
    dischargeEfficiency: settings.dischargeEfficiency,
  })
  const socJ = new Float64Array(count)
  socJ[0] = sub.socJ[0]
  for (let k = 0; k < steps; k++) socJ[k + 1] = sub.socJ[stepEnd[k]]
  const v = sub.firstReserveViolationIndex
  const battery = {
    socJ,
    unmetJ: sub.unmetJ,
    curtailedJ: sub.curtailedJ,
    minSocJ: sub.minSocJ,
    firstReserveViolationS: v === null ? null : v === 0 ? 0 : subEndS[v - 1],
  }

  const durationS = steps * stepS
  const longestEarthOutageS = longestGapS(earthWindows, durationS)
  return {
    siteId: data.site.id,
    startUtc,
    startIndex,
    alignedStartUtc: new Date(Date.parse(ephemeris.startUtc) + startIndex * stepS * 1000).toISOString().replace('.000Z', 'Z'),
    stepS,
    count,
    durationS,
    sunVisible,
    earthVisible,
    sunWindows,
    earthWindows,
    bothWindows,
    generationW,
    loadW,
    socJ: battery.socJ,
    batteryCapacityJ,
    sunDiskFraction: diskFraction,
    summary: {
      sunVisibleFraction: totalDurationS(sunWindows) / durationS,
      earthVisibleFraction: totalDurationS(earthWindows) / durationS,
      bothVisibleFraction: totalDurationS(bothWindows) / durationS,
      longestSunOutageS: longestGapS(sunWindows, durationS),
      longestEarthOutageS,
      energyGeneratedJ,
      energyDemandJ,
      unmetEnergyJ: battery.unmetJ,
      curtailedEnergyJ: battery.curtailedJ,
      minSocFraction: battery.minSocJ / batteryCapacityJ,
      finalSocFraction: battery.socJ[steps] / batteryCapacityJ,
      firstReserveViolationS: battery.firstReserveViolationS,
      keepsBatteryReserve: battery.firstReserveViolationS === null,
      earthOutageWithinLimit: longestEarthOutageS <= settings.maxEarthOutageH * 3600,
    },
    model: { ephemerisSource: ephemeris.source, solarConstantWm2: SOLAR_CONSTANT_W_M2, sunDiskModel: diskModel, notes: MODEL_NOTES[diskModel] },
  }
}

/**
 * Evaluates up to three scenarios (site + start time) with the same mission and hardware
 * settings, so their results can be compared like for like.
 */
export function evaluateScenarios(candidates: ScenarioCandidate[], settings: MissionSettings, bySite: Record<string, SiteData>): ScenarioResult[] {
  if (candidates.length > MAX_SCENARIOS) throw new RangeError(`At most ${MAX_SCENARIOS} scenarios can be compared.`)
  return candidates.map(({ siteId, startUtc }) => {
    const data = bySite[siteId]
    if (!data) throw new RangeError(`No data for site ${siteId}.`)
    return evaluateScenario(data, startUtc, settings)
  })
}
