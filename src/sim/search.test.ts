/// <reference types="node" />
/**
 * D acceptance tests for the searches (docs/ekip-notlari.md, D section): a search result equals
 * the direct engine run; all-fail / equal / Pareto trade-off; NaN data; mission at the data end
 * and +120 h; Sun never sets / Earth never rises; cancel and stale results; catalogue vs cell
 * labels; research equivalence fixtures.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MapDoc, SiteData, SitesDoc } from '../data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../data/extended.ts'
import { cellSiteData } from './cell.ts'
import { DEFAULT_SETTINGS, DataError, SettingsError, evaluateScenario } from './evaluate.ts'
import type { MissionSettings } from './evaluate.ts'
import type { ResearchProfile } from './research.ts'
import { compareResearch } from './research.ts'
import {
  cataloguePlaces,
  cellPlaces,
  dominates,
  findDatesForPlace,
  findNearbyEquivalentPlaces,
  findPlacesForDate,
  latestSearch,
  markPareto,
  type PlaceSource,
  type SearchCandidate,
} from './search.ts'

// ---------------------------------------------------------------- synthetic sites

const STEP = 600
const T0 = '2026-11-01T00:00:00Z'

/** A site with a flat 0° horizon and given Sun / Earth elevations per sample. */
function synthetic(id: string, n: number, sunEl: (i: number) => number, earthEl: (i: number) => number, latDeg = -89.5, lonDeg = 0): SiteData {
  const body = (el: (i: number) => number, dist: number) => ({
    azDeg: Array.from({ length: n }, (_, i) => (i * 0.5) % 360),
    elDeg: Array.from({ length: n }, (_, i) => el(i)),
    distanceM: Array.from({ length: n }, () => dist),
  })
  return {
    site: { id, name: id, latDeg, lonDeg, surfaceElevationM: 0, observerHeightM: 2, label: 'test', warnings: [] } as unknown as SiteData['site'],
    ephemeris: { siteId: id, source: 'test', startUtc: T0, stepS: STEP, count: n, sun: body(sunEl, 1.496e11), earth: body(earthEl, 3.84e8) },
    horizon: { azStepDeg: 1, count: 360, elevDeg: new Array(360).fill(0) },
  }
}

const DAY = 86400 / STEP
const N = 40 * DAY + 1
const settings: MissionSettings = { ...DEFAULT_SETTINGS, durationDays: 2 }
const iso = (i: number) => new Date(Date.parse(T0) + i * STEP * 1000).toISOString().replace('.000Z', 'Z')

const cand = (id: string, minSoc: number, both: number, outageH: number, startUtc = T0): SearchCandidate => ({
  siteId: id,
  startUtc,
  precision: 'catalogue',
  precisionLabel: '',
  metrics: { minSocFraction: minSoc, bothVisibleFraction: both, longestEarthOutageS: outageH * 3600 },
  summary: null,
  feasible: true,
  failures: [],
  pareto: false,
  research: { match: 'unknown', reasons: [] },
})

describe('Pareto', () => {
  it('keeps equal and trade-off candidates, drops dominated ones', () => {
    const a = cand('A', 0.8, 0.5, 2)
    const b = cand('B', 0.8, 0.5, 2) // equal to A
    const c = cand('C', 0.9, 0.2, 2) // trade-off with A
    const d = cand('D', 0.7, 0.4, 3) // dominated by A
    const list = [a, b, c, d]
    markPareto(list)
    expect(list.map((x) => x.pareto)).toEqual([true, true, true, false])
    expect(dominates(a.metrics!, b.metrics!)).toBe(false)
    expect(dominates(a.metrics!, d.metrics!)).toBe(true)
  })
})

describe('findDatesForPlace (synthetic)', () => {
  it('nothing passes when Earth never rises: no winner, reasons named, limits not relaxed', async () => {
    const data = synthetic('S', N, () => 10, () => -5)
    const r = await findDatesForPlace({ data, settings, fromUtc: T0, toUtc: iso(5 * DAY), refine: false })
    expect(r.status).toBe('complete')
    expect(r.feasible).toEqual([])
    expect(r.best).toBeNull()
    expect(r.failureCounts.earthOutage).toBe(6)
    expect(r.notes.join(' ')).toMatch(/No tested option meets every condition.*Earth out of view.*not relaxed/)
    expect(r.rejected[0].failures[0].message).toMatch(/limit is 6.0 h/)
  })

  it('Sun never sets and Earth always up: every start passes, ties sorted by time', async () => {
    const data = synthetic('S', N, () => 10, () => 5)
    const r = await findDatesForPlace({ data, settings, fromUtc: T0, toUtc: iso(3 * DAY), refine: false })
    expect(r.feasible).toHaveLength(4)
    expect(r.pareto).toHaveLength(4) // all equal: none dropped
    expect(r.feasible.map((c) => c.startUtc)).toEqual([0, 1, 2, 3].map((d) => iso(d * DAY)))
    expect(r.best!.startUtc).toBe(T0)
    expect(r.notes.join(' ')).toMatch(/best among the 4 tested options/)
  })

  it('NaN data is a data failure, never feasible', async () => {
    const data = synthetic('S', N, (i) => (i === DAY + 10 ? Number.NaN : 10), () => 5)
    expect(() => evaluateScenario(data, iso(DAY), settings)).toThrow(DataError)
    const r = await findDatesForPlace({ data, settings, fromUtc: T0, toUtc: iso(2 * DAY), refine: false })
    // starts at day 0 and day 1 include the NaN sample; day 2 does not
    expect(r.rejected.map((c) => c.failures[0].code)).toEqual(['data', 'data'])
    expect(r.feasible.map((c) => c.startUtc)).toEqual([iso(2 * DAY)])
  })

  it('mission ending on the last sample passes; one step later is outside the period, reported not shifted', async () => {
    const data = synthetic('S', N, () => 10, () => 5)
    const last = N - 1 - 2 * DAY
    expect(evaluateScenario(data, iso(last), settings).count).toBe(2 * DAY + 1)
    const r = await findDatesForPlace({ data, settings, fromUtc: iso(last), toUtc: iso(last + 1), coarseStepS: STEP, refine: false })
    expect(r.feasible.map((c) => c.startUtc)).toEqual([iso(last)])
    expect(r.rejected[0].failures[0].code).toBe('coverage')
    expect(r.notes.join(' ')).toMatch(/not shifted/)
    // +120 h comparison copy at the data end is refused the same way
    const r2 = await findDatesForPlace({ data, settings, fromUtc: iso(last + 120 * 6), toUtc: iso(last + 120 * 6), refine: false })
    expect(r2.failureCounts.coverage).toBe(1)
  })

  it('refines around the coarse finalists, hourly then per data step', async () => {
    // Sun up only in the first half of each "day"; Earth always up. A 2-day mission starting at
    // the dawn of a lit half keeps the battery highest.
    const data = synthetic('S', N, (i) => (Math.floor(i / (DAY / 2)) % 2 === 0 ? 10 : -10), () => 5)
    const r = await findDatesForPlace({ data, settings: { ...settings, batteryCapacityWh: 20000 }, fromUtc: iso(6 * 3), toUtc: iso(10 * DAY), finalists: 2 })
    expect(r.timeStep).toEqual({ coarseS: 86400, refineS: [3600, 600] })
    expect(r.tested).toBeGreaterThan(11)
    // the result equals a direct engine run
    const best = r.best!
    const direct = evaluateScenario(data, best.startUtc, { ...settings, batteryCapacityWh: 20000 })
    expect(best.summary).toEqual(direct.summary)
  })

  it('cancel gives a partial answer without a best; a budget does too', async () => {
    const data = synthetic('S', N, () => 10, () => 5)
    const ctl = new AbortController()
    const r = await findDatesForPlace({ data, settings, fromUtc: T0, toUtc: iso(30 * DAY), coarseStepS: 3600, refine: false }, { signal: ctl.signal, chunkSize: 10, onProgress: () => ctl.abort() })
    expect(r.status).toBe('cancelled')
    expect(r.tested).toBe(10)
    expect(r.best).toBeNull()
    expect(r.notes[0]).toMatch(/cancelled/)
    const r2 = await findDatesForPlace({ data, settings, fromUtc: T0, toUtc: iso(30 * DAY), refine: false }, { budgetMs: -1 })
    expect(r2.status).toBe('partial')
    expect(r2.best).toBeNull()
  })

  it('refuses invalid settings and leaves the settings object unchanged', async () => {
    const data = synthetic('S', N, () => 10, () => 5)
    const s = { ...settings }
    const before = JSON.stringify(s)
    await findDatesForPlace({ data, settings: s, fromUtc: T0, toUtc: iso(DAY) })
    expect(JSON.stringify(s)).toBe(before)
    await expect(findDatesForPlace({ data, settings: { ...s, durationDays: 0 }, fromUtc: T0, toUtc: iso(DAY) })).rejects.toThrow(SettingsError)
  })
})

describe('latestSearch', () => {
  it('a superseded search resolves to null and is aborted', async () => {
    const run = latestSearch()
    let firstSignal: AbortSignal | null = null
    const first = run(async (signal) => {
      firstSignal = signal
      await new Promise((r) => setTimeout(r, 5))
      return 'old'
    })
    const second = run(async () => 'new')
    expect(await second).toBe('new')
    expect(await first).toBeNull()
    expect(firstSignal!.aborted).toBe(true)
  })
})

// ---------------------------------------------------------------- research fixtures

const profile = (over: Partial<ResearchProfile> = {}): ResearchProfile => ({
  objectiveId: 'psr-volatiles',
  name: 'Study a shadowed surface',
  target: 'shadowed regolith',
  footprint: { latDeg: -89.5, lonDeg: 0, radiusM: 50000 },
  measurement: 'neutron spectroscopy',
  instruments: ['neutron spectrometer'],
  conditions: { minEarthFraction: 0.5 },
  status: 'verified',
  evidence: [{ source: 'Hypothetical test source', locator: 'p. 1' }],
  ...over,
})

describe('research equivalence', () => {
  const objective = profile()
  const where = { latDeg: -89.5, lonDeg: 0 }
  const sunny = { sunVisibleFraction: 1, earthVisibleFraction: 1 }

  it('missing metadata is unknown, never equivalent', () => {
    expect(compareResearch(objective, null, where, sunny).match).toBe('unknown')
    expect(compareResearch(objective, profile({ evidence: [] }), where, sunny).match).toBe('unknown')
    expect(compareResearch(objective, profile({ status: 'potential' }), where, sunny).match).toBe('unknown')
    expect(compareResearch(objective, profile(), where).match).toBe('unknown') // conditions not checked
    expect(compareResearch(null, profile(), where, sunny).match).toBe('unknown')
  })
  it('a different target, instrument or footprint is incompatible', () => {
    expect(compareResearch(objective, profile({ target: 'sunlit massif' }), where, sunny).match).toBe('incompatible')
    expect(compareResearch(objective, profile({ instruments: ['camera'] }), where, sunny).match).toBe('incompatible')
    expect(compareResearch(objective, profile({ footprint: { latDeg: -80, lonDeg: 0, radiusM: 1000 } }), where, sunny).match).toBe('incompatible')
  })
  it('time-dependent conditions are re-checked per mission', () => {
    expect(compareResearch(objective, profile(), where, sunny).match).toBe('equivalent')
    expect(compareResearch(objective, profile(), where, { sunVisibleFraction: 1, earthVisibleFraction: 0.2 }).match).toBe('incompatible')
  })

  it('nearby search: closer/better but other target is rejected, same research failing comms is rejected, unknown kept apart, equivalent listed', async () => {
    const lit = (id: string, lat: number, earth: (i: number) => number) => synthetic(id, N, () => 10, earth, lat)
    const origin = { siteId: 'O', latDeg: -89.5, lonDeg: 0 }
    const place = (d: SiteData, p: ResearchProfile | null): PlaceSource => ({ siteId: d.site.id, precision: 'catalogue', latDeg: d.site.latDeg, lonDeg: d.site.lonDeg, data: () => d, profile: p })
    const places = [
      place(lit('O', -89.5, () => 5), profile()),
      place(lit('Closer-other-target', -89.501, () => 5), profile({ objectiveId: 'ridge-geology', target: 'sunlit massif' })),
      place(lit('Same-research-no-comms', -89.51, () => -5), profile()),
      place(lit('No-profile', -89.52, () => 5), null),
      place(lit('Same-research-ok', -89.53, () => 5), profile()),
      place(lit('Too-far', -85, () => 5), profile({ footprint: { latDeg: -85, lonDeg: 0, radiusM: 50000 } })),
    ]
    const r = await findNearbyEquivalentPlaces({ origin, maxDistanceM: 5000, places, settings, startUtc: iso(DAY), objective: profile() })
    expect(r.spatialCoverage.places).toBe(4) // origin and the far one are not candidates
    expect(r.equivalent.map((c) => c.siteId)).toEqual(['Same-research-ok'])
    expect(r.unverified.map((c) => c.siteId)).toEqual(['No-profile'])
    const rejected = Object.fromEntries(r.rejected.map((c) => [c.siteId, c.failures.map((f) => f.code)]))
    expect(rejected['Closer-other-target']).toEqual(['research'])
    expect(rejected['Same-research-no-comms']).toContain('earthOutage')
    expect(r.best!.siteId).toBe('Same-research-ok')
    expect(r.equivalent[0].distanceM).toBeGreaterThan(800) // 0.03° of latitude ≈ 0.91 km
    expect(r.equivalent[0].distanceM).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------- real data

const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const real = (id: string): SiteData => ({
  site: sites.sites.find((s) => s.id === id)!,
  ephemeris: read(`${id}/ephemeris.json`),
  horizon: read(`${id}/horizon.json`),
  map: sites.sites.find((s) => s.id === id)!.category === 'contrast' ? undefined : read<MapDoc>(`${id}/map.json`),
})
const yearOf = (id: string) => parseYear(id, read<ExtendedHeader>(`${id}/extended.json`), readBin(`${id}/year.bin`))

describe('real data', () => {
  it('dates for Site04R over the year: April fails the reserve, the best start equals the direct run', async () => {
    const base = real('Site04R')
    const data = { ...base, ephemeris: yearOf('Site04R') }
    const r = await findDatesForPlace({ data, settings: DEFAULT_SETTINGS, fromUtc: '2026-11-15T00:00:00Z', toUtc: '2027-10-15T00:00:00Z', refine: false }, { maxRejected: 400 })
    expect(r.status).toBe('complete')
    const apr15 = [...r.feasible, ...r.rejected].find((c) => c.startUtc === '2027-04-15T00:00:00Z')
    // Story 3 of presentation-notes.md: reserve violated in April
    const direct = evaluateScenario(data, '2027-04-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(direct.summary.keepsBatteryReserve).toBe(false)
    expect(apr15?.feasible).toBe(false)
    expect(r.failureCounts.reserve).toBeGreaterThan(0)
    expect(r.best).not.toBeNull()
    expect(r.best!.summary).toEqual(evaluateScenario(data, r.best!.startUtc, DEFAULT_SETTINGS).summary)
    expect(r.best!.precisionLabel).toMatch(/0.1°/)
  })

  it('places for a date over Site01 map cells: slice re-projection equals the full cell run, labelled as screening', async () => {
    const base = real('Site01')
    const year = yearOf('Site01')
    const cells = parseCells(read<ExtendedHeader>('Site01/extended.json'), readBin('Site01/cells.bin'))
    const pick = (row: number, col: number) => row % 6 === 0 && col % 6 === 0
    const places = [...cataloguePlaces([base]), ...cellPlaces(base, year, cells, pick)]
    const startUtc = '2027-02-10T06:00:00Z'
    const t = Date.now()
    const r = await findPlacesForDate({ places, settings: DEFAULT_SETTINGS, startUtc, sortBy: 'earthOutage' })
    const ms = Date.now() - t
    expect(r.spatialCoverage.places).toBe(1 + 11 * 11)
    // Site01 catalogue start is outside the two-month ephemeris: reported, not shifted
    const catalogue = [...r.feasible, ...r.rejected].find((c) => c.siteId === 'Site01')
    expect(catalogue?.failures.map((f) => f.code)).toEqual(['coverage'])
    const anyCell = [...r.feasible, ...r.rejected].find((c) => c.precision === 'cell' && c.summary)!
    const m = /:r(\d+)c(\d+)$/.exec(anyCell.siteId)!
    const full = evaluateScenario(cellSiteData(base, year, cells, Number(m[1]), Number(m[2])), startUtc, DEFAULT_SETTINGS)
    for (const k of ['sunVisibleFraction', 'earthVisibleFraction', 'minSocFraction', 'longestEarthOutageS'] as const) {
      expect(anyCell.summary![k], k).toBeCloseTo(full.summary[k], 9)
    }
    expect(anyCell.precisionLabel).toMatch(/1° horizon.*screening/)
    expect(r.notes.join(' ')).toMatch(/regional screening estimate/)
    expect(r.notes.join(' ')).toMatch(/could not be verified/)
    expect(ms).toBeLessThan(5000)
  })
})

describe('runSearch', () => {
  it('without Worker support runs the same request on this thread', async () => {
    const { runSearch } = await import('./searchClient.ts')
    const data = synthetic('S', N, () => 10, () => 5)
    const progress: number[] = []
    const r = await runSearch({ kind: 'dates', data, settings, fromUtc: T0, toUtc: iso(2 * DAY), refine: false }, { onProgress: (d) => progress.push(d) })
    expect(typeof Worker).toBe('undefined')
    expect(r.tested).toBe(3)
    expect(progress.at(-1)).toBe(3)
  })
})
