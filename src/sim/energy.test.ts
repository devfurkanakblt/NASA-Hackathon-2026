import { describe, expect, it } from 'vitest'
import type { SiteData } from '../data/contract.ts'
import { AU_M, J_PER_WH, clearSkyPanelPowerW, cosBetween, simulateBattery, solarFluxWm2 } from './energy.ts'
import type { PanelSettings } from './energy.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario, evaluateScenarios } from './evaluate.ts'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

const tracking: PanelSettings = { panelAreaM2: 2, panelEfficiency: 0.25, systemFactor: 0.8, panelMode: 'tracking', fixedNormalAzDeg: 0, fixedNormalElDeg: 0 }
const fixedNorth: PanelSettings = { ...tracking, panelMode: 'fixed' }

describe('panel power', () => {
  it('is flux × area × efficiency × system factor for a tracking panel', () => {
    close(clearSkyPanelPowerW(tracking, 123, 1.5, AU_M), 1361 * 2 * 0.25 * 0.8)
    close(clearSkyPanelPowerW(tracking, 123, 1.5, AU_M), 544.4)
  })

  it('scales with the inverse square of the Sun distance', () => {
    close(solarFluxWm2(AU_M), 1361)
    close(solarFluxWm2(2 * AU_M), 1361 / 4)
    close(clearSkyPanelPowerW(tracking, 0, 0, 0.983 * AU_M), 544.4 / 0.983 ** 2, 1e-9)
  })

  it('follows the cosine law for a fixed panel and is zero when the Sun is behind it', () => {
    close(clearSkyPanelPowerW(fixedNorth, 0, 0, AU_M), 544.4)
    close(clearSkyPanelPowerW(fixedNorth, 60, 0, AU_M), 272.2)
    close(clearSkyPanelPowerW(fixedNorth, 90, 0, AU_M), 0, 1e-9)
    expect(clearSkyPanelPowerW(fixedNorth, 180, 0, AU_M)).toBe(0)
    expect(clearSkyPanelPowerW(fixedNorth, 135, 2, AU_M)).toBe(0)
  })

  it('measures the angle between two directions', () => {
    close(cosBetween(10, 0, 10, 0), 1)
    close(cosBetween(0, 0, 90, 0), 0)
    close(cosBetween(0, 90, 77, 0), 0)
    close(cosBetween(350, 0, 10, 0), Math.cos((20 * Math.PI) / 180))
  })
})

describe('battery', () => {
  const battery = { capacityJ: 1000, initialJ: 500, reserveJ: 200, chargeEfficiency: 0.9, dischargeEfficiency: 0.9 }

  it('charges with the charge efficiency and stops at capacity', () => {
    const r = simulateBattery([100, 100, 1000], [0, 0, 0], battery)
    close(r.socJ[1], 590)
    close(r.socJ[2], 680)
    close(r.socJ[3], 1000)
    close(r.curtailedJ, 1000 - 320 / 0.9)
    expect(r.unmetJ).toBe(0)
    expect(r.firstReserveViolationIndex).toBeNull()
  })

  it('discharges with the discharge efficiency and flags the first reserve violation', () => {
    const r = simulateBattery([0, 0, 0, 0], [90, 90, 90, 90], battery)
    expect(Array.from(r.socJ)).toEqual([500, 400, 300, 200, 100])
    expect(r.firstReserveViolationIndex).toBe(4) // 200 is still at the reserve, 100 is below it
    close(r.minSocJ, 100)
    expect(r.unmetJ).toBe(0)
  })

  it('records the demand it cannot serve when it runs empty', () => {
    const r = simulateBattery([0, 0], [360, 360], battery)
    close(r.socJ[1], 100)
    close(r.socJ[2], 0)
    close(r.unmetJ, 360 - 100 * 0.9)
  })

  it('lets generation serve the load directly, without battery losses', () => {
    const r = simulateBattery([300, 300], [300, 300], battery)
    expect(Array.from(r.socJ)).toEqual([500, 500, 500])
  })

  it('flags a battery that starts below its reserve', () => {
    expect(simulateBattery([0], [0], { ...battery, initialJ: 100 }).firstReserveViolationIndex).toBe(0)
  })
})

/** Synthetic site: flat horizon at 0°, Sun up for the first half of the day, Earth for the second. */
function syntheticSite(days = 3): SiteData {
  const count = days * 144 + 1
  const up = (i: number, phase: number) => (((i + phase) % 144) < 72 ? 2 : -2)
  return {
    site: { id: 'Test', name: 'Test', latDeg: -89, lonDeg: 0, surfaceElevationM: 0, observerHeightM: 2, coordSource: '', demNear: '', demFar: '', label: '', warnings: [] },
    ephemeris: {
      siteId: 'Test',
      source: 'synthetic',
      startUtc: '2026-11-01T00:00:00Z',
      stepS: 600,
      count,
      sun: { azDeg: Array.from({ length: count }, (_, i) => (i * 2.5) % 360), elDeg: Array.from({ length: count }, (_, i) => up(i, 0)), distanceM: new Array(count).fill(AU_M) },
      earth: { azDeg: new Array(count).fill(140), elDeg: Array.from({ length: count }, (_, i) => up(i, 72)), distanceM: new Array(count).fill(3.844e8) },
    },
    horizon: { azStepDeg: 0.1, count: 3600, elevDeg: new Array(3600).fill(0), distanceM: new Array(3600).fill(1000) },
    terrain: { sizeM: 10, n: 2, cellM: 5, zM: [0, 0, 0, 0] },
  }
}

describe('evaluateScenario', () => {
  const site = syntheticSite()
  const settings = { ...DEFAULT_SETTINGS, durationDays: 2 }
  const result = evaluateScenario(site, '2026-11-01T00:00:00Z', settings)

  it('produces nothing while the Sun is down', () => {
    expect(result.sunVisible[10]).toBe(true)
    close(result.generationW[10], 544.4)
    expect(result.sunVisible[100]).toBe(false)
    expect(result.generationW[100]).toBe(0)
  })

  it('adds the communication load only while Earth is in view', () => {
    expect(result.loadW[10]).toBe(200)
    expect(result.loadW[100]).toBe(300)
  })

  it('reports visibility shares, outages and the energy balance in consistent units', () => {
    const { summary } = result
    close(summary.sunVisibleFraction, 0.5, 0.01)
    close(summary.earthVisibleFraction, 0.5, 0.01)
    close(summary.bothVisibleFraction, 0, 0.01)
    close(summary.longestSunOutageS, 12 * 3600, 1200)
    // 544.4 W for 24 h of the 48 h mission ≈ 13.07 kWh; 200 W + 100 W for half the time ≈ 12 kWh
    close(summary.energyGeneratedJ / J_PER_WH, 544.4 * 24, 544.4 * 0.2)
    close(summary.energyDemandJ / J_PER_WH, 200 * 48 + 100 * 24, 40)
    expect(result.socJ.length).toBe(result.count)
    expect(result.batteryCapacityJ).toBe(5000 * J_PER_WH)
    expect(Math.max(...result.socJ)).toBeLessThanOrEqual(result.batteryCapacityJ)
    expect(Math.min(...result.socJ)).toBeGreaterThanOrEqual(0)
  })

  it('states the two conditions plainly', () => {
    // 12 h of darkness at 300 W drains 4 kWh from a 5 kWh battery: below the 20% reserve.
    expect(result.summary.keepsBatteryReserve).toBe(false)
    expect(result.summary.firstReserveViolationS).not.toBeNull()
    expect(result.summary.earthOutageWithinLimit).toBe(false) // 12 h without Earth > 6 h
    const generous = evaluateScenario(site, '2026-11-01T00:00:00Z', { ...settings, batteryCapacityWh: 20000, maxEarthOutageH: 13 })
    expect(generous.summary.keepsBatteryReserve).toBe(true)
    expect(generous.summary.firstReserveViolationS).toBeNull()
    expect(generous.summary.earthOutageWithinLimit).toBe(true)
  })

  it('gives zero output to a fixed panel that faces away from the Sun all mission', () => {
    const still: SiteData = { ...site, ephemeris: { ...site.ephemeris, sun: { ...site.ephemeris.sun, azDeg: new Array(site.ephemeris.count).fill(180) } } }
    const away = evaluateScenario(still, '2026-11-01T00:00:00Z', { ...settings, panelMode: 'fixed', fixedNormalAzDeg: 0, fixedNormalElDeg: 0 })
    expect(away.summary.energyGeneratedJ).toBe(0)
    expect(away.summary.unmetEnergyJ).toBeGreaterThan(0)
  })

  it('rejects missions outside the computed period', () => {
    expect(() => evaluateScenario(site, '2026-10-31T00:00:00Z', settings)).toThrow(CoverageError)
    expect(() => evaluateScenario(site, '2026-11-02T12:00:00Z', settings)).toThrow(CoverageError)
    expect(() => evaluateScenario(site, 'not a date', settings)).toThrow(CoverageError)
    expect(() => evaluateScenario(site, '2026-11-02T00:00:00Z', settings)).not.toThrow()
  })

  it('starts a shifted mission at the right sample', () => {
    const later = evaluateScenario(site, '2026-11-01T12:00:00Z', { ...settings, durationDays: 1 })
    expect(later.startIndex).toBe(72)
    expect(later.count).toBe(145)
    expect(later.sunVisible[0]).toBe(false)
  })
})

describe('evaluateScenarios', () => {
  const bySite = { Test: syntheticSite() }
  const start = '2026-11-01T00:00:00Z'

  it('applies the same settings to every candidate', () => {
    const results = evaluateScenarios([{ siteId: 'Test', startUtc: start }, { siteId: 'Test', startUtc: '2026-11-01T12:00:00Z' }], { ...DEFAULT_SETTINGS, durationDays: 1 }, bySite)
    expect(results.map((r) => r.startIndex)).toEqual([0, 72])
    expect(results.every((r) => r.batteryCapacityJ === 5000 * J_PER_WH)).toBe(true)
  })

  it('accepts at most three candidates and only known sites', () => {
    const four = new Array(4).fill({ siteId: 'Test', startUtc: start })
    expect(() => evaluateScenarios(four, DEFAULT_SETTINGS, bySite)).toThrow(RangeError)
    expect(() => evaluateScenarios([{ siteId: 'Nowhere', startUtc: start }], DEFAULT_SETTINGS, bySite)).toThrow(RangeError)
  })
})

describe('partial Sun disk model (optional)', () => {
  const site = syntheticSite()
  const base = { ...DEFAULT_SETTINGS, durationDays: 2 }
  const centre = evaluateScenario(site, '2026-11-01T00:00:00Z', base)
  const partial = evaluateScenario(site, '2026-11-01T00:00:00Z', { ...base, sunDiskModel: 'partial' })

  it('is off by default and leaves the centre-based results unchanged', () => {
    expect(DEFAULT_SETTINGS.sunDiskModel).toBe('centre')
    expect(centre.model.sunDiskModel).toBe('centre')
    const implicit = evaluateScenario(site, '2026-11-01T00:00:00Z', { ...base, sunDiskModel: undefined })
    expect(implicit.summary).toEqual(centre.summary)
  })

  it('keeps visibility on the centre and only reweights the panel output', () => {
    expect(partial.model.sunDiskModel).toBe('partial')
    expect(partial.sunWindows).toEqual(centre.sunWindows)
    expect(partial.summary.sunVisibleFraction).toBe(centre.summary.sunVisibleFraction)
    // the synthetic Sun sits 2° above or below a flat horizon: whole disk or none of it
    for (let k = 0; k < partial.count; k++) close(partial.sunDiskFraction[k], centre.sunVisible[k] ? 1 : 0)
    expect(Array.from(partial.generationW)).toEqual(Array.from(centre.generationW))
    close(partial.summary.energyGeneratedJ / J_PER_WH, centre.summary.energyGeneratedJ / J_PER_WH, 544.4 * 0.2)
  })
})
