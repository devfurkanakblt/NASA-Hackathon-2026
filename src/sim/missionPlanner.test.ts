import { describe, expect, it } from 'vitest'
import type { SiteData } from '../data/contract.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { findMissionForPlace } from './missionPlanner.ts'
import { hemisphereGrid, leadingTies, REGION_NORTH_LIMIT_DEG, regionOrder } from './hemisphere.ts'
import { freePointId } from './freePoint.ts'
import { constraintFailures, type SearchCandidate } from './search.ts'
import { plannerDiagnostics } from '../app/plannerDiagnostics.ts'

const startUtc = '2026-11-01T00:00:00Z'
const count = 5 * 144 + 1
const body = (el: number, distance: number) => ({ azDeg: Array(count).fill(0), elDeg: Array(count).fill(el), distanceM: Array(count).fill(distance) })
const data = {
  site: { id: 'test', name: 'Test', latDeg: -80, lonDeg: 0, surfaceElevationM: 0, observerHeightM: 2, warnings: [], coordSource: 'test', demNear: 'test', demFar: 'test', label: 'test' },
  horizon: { azStepDeg: 1, count: 360, elevDeg: Array(360).fill(0) },
  ephemeris: { siteId: 'test', source: 'test', startUtc, stepS: 600, count, sun: body(-10, 1.496e11), earth: body(10, 3.84e8) },
} as SiteData
const settings = { ...DEFAULT_SETTINGS, panelAreaM2: 0, batteryCapacityWh: 5000, initialSocFraction: 1, reserveFraction: 0, baseLoadW: 100, commLoadW: 0, dischargeEfficiency: 1 }

describe('joint date and duration planning', () => {
  it('finds the longest feasible duration and matches a direct simulation', async () => {
    const r = await findMissionForPlace({ data, settings, fromUtc: startUtc, toUtc: startUtc, maxDurationDays: 5 })
    expect(r.status).toBe('complete')
    expect(r.best?.durationDays).toBe(2)
    expect(r.best?.summary).toEqual(evaluateScenario(data, startUtc, { ...settings, durationDays: 2 }).summary)
    expect(constraintFailures(evaluateScenario(data, startUtc, { ...settings, durationDays: 3 }).summary, settings).length).toBeGreaterThan(0)
  })
  it('respects coverage at the end of the source series', async () => {
    const date = '2026-11-05T00:00:00Z'
    const r = await findMissionForPlace({ data, settings, fromUtc: date, toUtc: date, maxDurationDays: 90 })
    expect(r.best?.durationDays).toBe(1)
  })
  it('does not recommend a failed or cancelled mission', async () => {
    const input = { data, settings: { ...settings, batteryCapacityWh: 1 }, fromUtc: startUtc, toUtc: startUtc, maxDurationDays: 5 }
    expect((await findMissionForPlace(input)).best).toBeNull()
    const abort = new AbortController(); abort.abort()
    const cancelled = await findMissionForPlace(input, { signal: abort.signal })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.best).toBeNull()
  })
  it('rejects non-integer duration limits', async () => {
    await expect(findMissionForPlace({ data, settings, fromUtc: startUtc, toUtc: startUtc, maxDurationDays: 1.5 })).rejects.toThrow('whole number')
  })
  it('separates coverage errors from physical failures', async () => {
    const r = await findMissionForPlace({ data, settings, fromUtc: '2027-01-01T00:00:00Z', toUtc: '2027-01-01T00:00:00Z', maxDurationDays: 5 })
    expect(r.durationScreening?.coveredStarts).toBe(0)
    expect(r.durationScreening?.earthHiddenAtEveryCoveredStart).toBe(false)
    expect(plannerDiagnostics(r).explanation).toContain('usable data')
    expect(plannerDiagnostics(r).failures).toEqual([{ code: 'coverage', count: 1, label: 'Mission outside source coverage' }])
  })
})

describe('southern hemisphere coverage', () => {
  it('covers every southern latitude band and longitude without duplicate coordinates', () => {
    for (const step of [5, 10, 15]) {
      const grid = hemisphereGrid(step)
      expect(grid.every(p => p.latDeg >= -90 && p.latDeg < 0)).toBe(true)
      expect(grid.filter(p => p.latDeg === -90)).toHaveLength(1)
      expect(new Set(grid.map(p => freePointId(p.latDeg, p.lonDeg))).size).toBe(grid.length)
      for (let lat = -90 + step; lat < 0; lat += step) {
        const ring = grid.filter(p => p.latDeg === lat)
        expect(ring.length).toBeGreaterThan(0)
        expect(360 / ring.length * Math.cos(lat * Math.PI / 180)).toBeLessThanOrEqual(step)
      }
    }
    expect(hemisphereGrid(5).length).toBeGreaterThan(hemisphereGrid(15).length)
    expect(() => hemisphereGrid(0)).toThrow()
  })
})

describe('south polar search region', () => {
  it('stops at 60°S and never samples the equator', () => {
    for (const step of [5, 10, 15]) {
      const polar = hemisphereGrid(step, REGION_NORTH_LIMIT_DEG.polar)
      expect(polar.every(p => p.latDeg <= -60)).toBe(true)
      expect(polar.some(p => p.latDeg === -60)).toBe(true)
      expect(hemisphereGrid(step).every(p => p.latDeg <= -step)).toBe(true)
    }
  })

  it('breaks ties on the chosen metric by end charge, other metrics, then nearness to the pole', () => {
    const cand = (siteId: string, minSoc: number, finalSoc: number, both = 1): SearchCandidate => ({
      siteId, startUtc: '2026-11-15T00:00:00Z', precision: 'global', precisionLabel: '', feasible: true, failures: [], pareto: true,
      research: { match: 'unverified' } as unknown as SearchCandidate['research'],
      metrics: { minSocFraction: minSoc, bothVisibleFraction: both, longestEarthOutageS: 0 },
      summary: { finalSocFraction: finalSoc } as SearchCandidate['summary'],
    })
    const lat: Record<string, number> = { equator: -0.1, mid: -45, pole: -85 }
    const order = regionOrder('minSoc', c => lat[c.siteId])
    // All tie at the starting charge: the point nearer the pole wins.
    expect([cand('equator', 0.8, 1), cand('mid', 0.8, 1), cand('pole', 0.8, 1)].sort(order).map(c => c.siteId)).toEqual(['pole', 'mid', 'equator'])
    // A higher end-of-mission charge beats latitude.
    expect([cand('pole', 0.8, 0.9), cand('equator', 0.8, 1)].sort(order)[0].siteId).toBe('equator')
    // The chosen metric still comes first.
    expect([cand('pole', 0.7, 1), cand('equator', 0.8, 0.5)].sort(order)[0].siteId).toBe('equator')
    const sorted = [cand('pole', 0.8, 1), cand('mid', 0.8, 1), cand('equator', 0.7, 1)].sort(order)
    expect(leadingTies(sorted, 'minSoc')).toBe(2)
  })
})
