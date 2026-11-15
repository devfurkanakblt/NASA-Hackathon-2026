/**
 * Acceptance checks from the plan (§5 "Kabul testleri") that concern the engine's inputs:
 * UTC handling, settings ranges, and speed.
 */
import { describe, expect, it } from 'vitest'
import type { SiteData } from '../data/contract.ts'
import { AU_M } from './energy.ts'
import { DEFAULT_SETTINGS, MAX_DURATION_DAYS, SettingsError, evaluateScenario, evaluateScenarios, sampleUtc, validateSettings } from './evaluate.ts'

/** A 62-day synthetic site (the length of the real coverage) with a slowly turning Sun. */
function site(days = 62): SiteData {
  const count = days * 144 + 1
  return {
    site: { id: 'Test', name: 'Test', latDeg: -89, lonDeg: 0, surfaceElevationM: 0, observerHeightM: 2, coordSource: '', demNear: '', demFar: '', label: '', warnings: [] },
    ephemeris: {
      siteId: 'Test',
      source: 'synthetic',
      startUtc: '2026-11-01T00:00:00Z',
      stepS: 600,
      count,
      sun: { azDeg: Array.from({ length: count }, (_, i) => (i * 0.25) % 360), elDeg: Array.from({ length: count }, (_, i) => 1.5 * Math.sin(i / 300)), distanceM: new Array(count).fill(AU_M) },
      earth: { azDeg: new Array(count).fill(140), elDeg: Array.from({ length: count }, (_, i) => 3 * Math.sin(i / 700)), distanceM: new Array(count).fill(3.844e8) },
    },
    horizon: { azStepDeg: 0.1, count: 3600, elevDeg: Array.from({ length: 3600 }, (_, i) => 0.5 + 0.5 * Math.sin(i / 100)), distanceM: new Array(3600).fill(1000) },
    terrain: { sizeM: 10, n: 2, cellM: 5, zM: [0, 0, 0, 0] },
  }
}

describe('UTC handling', () => {
  const data = site()

  it('reads time-zone offsets as the same instant in UTC', () => {
    const utc = evaluateScenario(data, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    const istanbul = evaluateScenario(data, '2026-11-15T03:00:00+03:00', DEFAULT_SETTINGS)
    expect(istanbul.startIndex).toBe(utc.startIndex)
    expect(istanbul.alignedStartUtc).toBe('2026-11-15T00:00:00Z')
    expect(istanbul.summary).toEqual(utc.summary)
  })

  it('snaps an off-grid start to the nearest 10-minute sample and says so', () => {
    const r = evaluateScenario(data, '2026-11-15T00:04:00Z', DEFAULT_SETTINGS)
    expect(r.startUtc).toBe('2026-11-15T00:04:00Z')
    expect(r.alignedStartUtc).toBe('2026-11-15T00:00:00Z')
    expect(evaluateScenario(data, '2026-11-15T00:06:00Z', DEFAULT_SETTINGS).alignedStartUtc).toBe('2026-11-15T00:10:00Z')
  })

  it('gives the UTC of every sample for the charts', () => {
    const r = evaluateScenario(data, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(sampleUtc(r, 0)).toBe('2026-11-15T00:00:00Z')
    expect(sampleUtc(r, 1)).toBe('2026-11-15T00:10:00Z')
    expect(sampleUtc(r, r.count - 1)).toBe('2026-11-22T00:00:00Z')
  })

  it('accepts a mission that ends exactly on the last sample and refuses one that ends after it', () => {
    const short = site(31) // last sample: 2026-12-02T00:00:00Z
    expect(() => evaluateScenario(short, '2026-11-02T00:00:00Z', { ...DEFAULT_SETTINGS, durationDays: 30 })).not.toThrow()
    expect(() => evaluateScenario(short, '2026-11-02T00:10:00Z', { ...DEFAULT_SETTINGS, durationDays: 30 })).toThrow(/computed period/)
  })
})

describe('validateSettings', () => {
  it('accepts the defaults and both panel / disk modes', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([])
    expect(validateSettings({ ...DEFAULT_SETTINGS, panelMode: 'fixed', fixedNormalAzDeg: 270, fixedNormalElDeg: 10, sunDiskModel: 'partial' })).toEqual([])
    expect(validateSettings({ ...DEFAULT_SETTINGS, durationDays: 1 })).toEqual([])
    expect(validateSettings({ ...DEFAULT_SETTINGS, durationDays: MAX_DURATION_DAYS })).toEqual([])
  })

  it('allows missions up to 90 days', () => {
    expect(MAX_DURATION_DAYS).toBe(90)
    expect(validateSettings({ ...DEFAULT_SETTINGS, durationDays: 90 })).toEqual([])
    expect(validateSettings({ ...DEFAULT_SETTINGS, durationDays: 91 }).join(' ')).toMatch(/1–90 days/)
  })

  it('names every value that is out of range', () => {
    const issues = validateSettings({ ...DEFAULT_SETTINGS, durationDays: MAX_DURATION_DAYS + 1,panelEfficiency: 1.2, reserveFraction: -0.1, batteryCapacityWh: 0, baseLoadW: Number.NaN })
    expect(issues).toHaveLength(5)
    expect(issues.join(' ')).toMatch(/duration/)
    expect(issues.join(' ')).toMatch(/efficiency/)
    expect(issues.join(' ')).toMatch(/reserve/)
    expect(issues.join(' ')).toMatch(/capacity/)
    expect(issues.join(' ')).toMatch(/Base load/)
  })

  it('makes the engine refuse bad settings instead of computing nonsense', () => {
    expect(() => evaluateScenario(site(), '2026-11-15T00:00:00Z', { ...DEFAULT_SETTINGS, durationDays: 0.5 })).toThrow(SettingsError)
    expect(() => evaluateScenario(site(), '2026-11-15T00:00:00Z', { ...DEFAULT_SETTINGS, dischargeEfficiency: 0 })).toThrow(SettingsError)
  })
})

describe('performance (plan: three scenarios in about two seconds)', () => {
  it('evaluates three 30-day scenarios well within the budget', () => {
    const data = site()
    const bySite = { Test: data }
    const settings = { ...DEFAULT_SETTINGS, durationDays: 30, sunDiskModel: 'partial' as const }
    const candidates = ['2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z', '2026-11-20T00:00:00Z'].map((startUtc) => ({ siteId: 'Test', startUtc }))
    evaluateScenarios(candidates, settings, bySite) // warm-up
    const t0 = performance.now()
    const results = evaluateScenarios(candidates, settings, bySite)
    const elapsedMs = performance.now() - t0
    expect(results).toHaveLength(3)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('evaluates three maximum-length scenarios within the budget', () => {
    const data = site(MAX_DURATION_DAYS + 30)
    const bySite = { Test: data }
    const settings = { ...DEFAULT_SETTINGS, durationDays: MAX_DURATION_DAYS, sunDiskModel: 'partial' as const }
    const candidates = ['2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z', '2026-12-01T00:00:00Z'].map((startUtc) => ({ siteId: 'Test', startUtc }))
    evaluateScenarios(candidates, settings, bySite) // warm-up
    const t0 = performance.now()
    const results = evaluateScenarios(candidates, settings, bySite)
    const elapsedMs = performance.now() - t0
    expect(results).toHaveLength(3)
    expect(results[0].count).toBe(MAX_DURATION_DAYS * 144 + 1)
    expect(elapsedMs).toBeLessThan(1500)
  })
})

describe('battery across a rise inside a step (analytic)', () => {
  // Flat 0° horizon, 600 s steps. Sun: −1° → +1° over step 0 (rises at its middle), then up.
  // Earth: −1° → +1° over step 2 (rises at its middle), then up. Battery starts empty.
  const n = 200
  const series = (el: (i: number) => number, d: number) => ({ azDeg: new Array(n).fill(0), elDeg: Array.from({ length: n }, (_, i) => el(i)), distanceM: new Array(n).fill(d) })
  const data = {
    site: { id: 'S', latDeg: 0, lonDeg: 0, surfaceElevationM: 0, observerHeightM: 2 },
    ephemeris: { siteId: 'S', source: 't', startUtc: '2026-11-01T00:00:00Z', stepS: 600, count: n, sun: series((i) => (i === 0 ? -1 : 1), 1.496e11), earth: series((i) => (i <= 2 ? -1 : 1), 3.84e8) },
    horizon: { azStepDeg: 1, count: 360, elevDeg: new Array(360).fill(0) },
  } as unknown as SiteData
  const s = { ...DEFAULT_SETTINGS, durationDays: 1, initialSocFraction: 0, reserveFraction: 0, maxEarthOutageH: 1000 }

  it('demand before sunrise is unmet, not paid by generation later in the same step', () => {
    const r = evaluateScenario(data, '2026-11-01T00:00:00Z', s)
    // 300 s of base load with an empty battery and no Sun
    expect(r.summary.unmetEnergyJ).toBeCloseTo(s.baseLoadW * 300, 6)
    // after sunrise the panel covers the load and charges: SoC after step 0 is the stored surplus
    const panelW = r.generationW[1]
    expect(r.socJ[1]).toBeCloseTo((panelW - s.baseLoadW) * 300 * s.chargeEfficiency, 6)
  })

  it('the comm load starts at Earthrise inside the step; energy totals are exact', () => {
    const r = evaluateScenario(data, '2026-11-01T00:00:00Z', s)
    const T = r.durationS
    const earthUpS = T - 2.5 * 600
    expect(r.summary.energyDemandJ).toBeCloseTo(s.baseLoadW * T + s.commLoadW * earthUpS, 6)
    expect(r.summary.earthVisibleFraction).toBeCloseTo(earthUpS / T, 12)
  })
})
