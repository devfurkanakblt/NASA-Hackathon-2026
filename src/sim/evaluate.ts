import type { SiteData } from '../data/contract.ts'
import { J_PER_WH, SOLAR_CONSTANT_W_M2, clearSkyPanelPowerW, simulateBattery } from './energy.ts'
import type { PanelSettings } from './energy.ts'
import { intersectWindows, longestGapS, marginSeries, stepFractions, totalDurationS, windowsFromMargins } from './visibility.ts'
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
}

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
}

export const MAX_SCENARIOS = 3

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
  model: {
    ephemerisSource: string
    solarConstantWm2: number
    notes: string[]
  }
}

const MODEL_NOTES = [
  'Sun and Earth count as visible when their centre is above the terrain horizon; partial discs are not modelled.',
  'Eclipses and temperature effects are not modelled.',
  'Earth view is line of sight only: no ground-station, antenna or link-budget claim.',
]

/** Thrown when a mission does not fit inside the pre-computed data. */
export class CoverageError extends RangeError {}

/**
 * Runs one scenario: where the Sun and Earth are over the mission, when terrain hides them,
 * what the panel produces and how the battery fares. Pure: same inputs, same result.
 */
export function evaluateScenario(data: SiteData, startUtc: string, settings: MissionSettings): ScenarioResult {
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

  const sunMargin = marginSeries(ephemeris.sun, horizon, startIndex, count)
  const earthMargin = marginSeries(ephemeris.earth, horizon, startIndex, count)
  const sunWindows = windowsFromMargins(sunMargin, stepS)
  const earthWindows = windowsFromMargins(earthMargin, stepS)
  const bothWindows = intersectWindows(sunWindows, earthWindows)
  const sunShare = stepFractions(sunMargin)
  const earthShare = stepFractions(earthMargin)

  // Instantaneous values at every sample (for the 3D view and the charts).
  const clearW = new Float64Array(count)
  const generationW = new Float64Array(count)
  const loadW = new Float64Array(count)
  const sunVisible: boolean[] = []
  const earthVisible: boolean[] = []
  for (let k = 0; k < count; k++) {
    const i = startIndex + k
    sunVisible.push(sunMargin[k] > 0)
    earthVisible.push(earthMargin[k] > 0)
    clearW[k] = clearSkyPanelPowerW(settings, ephemeris.sun.azDeg[i], ephemeris.sun.elDeg[i], ephemeris.sun.distanceM[i])
    generationW[k] = sunVisible[k] ? clearW[k] : 0
    loadW[k] = settings.baseLoadW + (earthVisible[k] ? settings.commLoadW : 0)
  }

  // Energy per step: mean clear-sky power times the part of the step the Sun was up;
  // the communication load runs for the part of the step Earth was up.
  const generationJ = new Float64Array(steps)
  const demandJ = new Float64Array(steps)
  let energyGeneratedJ = 0
  let energyDemandJ = 0
  for (let k = 0; k < steps; k++) {
    generationJ[k] = 0.5 * (clearW[k] + clearW[k + 1]) * sunShare[k] * stepS
    demandJ[k] = (settings.baseLoadW + settings.commLoadW * earthShare[k]) * stepS
    energyGeneratedJ += generationJ[k]
    energyDemandJ += demandJ[k]
  }

  const batteryCapacityJ = settings.batteryCapacityWh * J_PER_WH
  const battery = simulateBattery(generationJ, demandJ, {
    capacityJ: batteryCapacityJ,
    initialJ: batteryCapacityJ * settings.initialSocFraction,
    reserveJ: batteryCapacityJ * settings.reserveFraction,
    chargeEfficiency: settings.chargeEfficiency,
    dischargeEfficiency: settings.dischargeEfficiency,
  })

  const durationS = steps * stepS
  const longestEarthOutageS = longestGapS(earthWindows, durationS)
  return {
    siteId: data.site.id,
    startUtc,
    startIndex,
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
      firstReserveViolationS: battery.firstReserveViolationIndex === null ? null : battery.firstReserveViolationIndex * stepS,
      keepsBatteryReserve: battery.firstReserveViolationIndex === null,
      earthOutageWithinLimit: longestEarthOutageS <= settings.maxEarthOutageH * 3600,
    },
    model: { ephemerisSource: ephemeris.source, solarConstantWm2: SOLAR_CONSTANT_W_M2, notes: MODEL_NOTES },
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
