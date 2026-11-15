/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MapDoc, SiteData, SitesDoc } from '../data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader, type RefinedDoc } from '../data/extended.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../sim/evaluate.ts'
import { runSearchRequest } from '../sim/searchRequest.ts'
import { datesRequest, placesRequest, type Loaders } from './searchInputs.ts'

const DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DIR + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DIR + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json').sites
const bySite: Record<string, SiteData> = Object.fromEntries(
  sites.map((s) => {
    let map: MapDoc | undefined
    try { map = read<MapDoc>(`${s.id}/map.json`) } catch { map = undefined }
    return [s.id, { site: s, ephemeris: read(`${s.id}/ephemeris.json`), horizon: read(`${s.id}/horizon.json`), terrain: { sizeM: 1, n: 1, cellM: 1, zM: [0] }, map }]
  }),
)
const calls: string[] = []
const loaders: Loaders = {
  year: async (id) => { calls.push(`year:${id}`); return parseYear(id, read<ExtendedHeader>(`${id}/extended.json`), bin(`${id}/year.bin`)) },
  header: async (id) => read<ExtendedHeader>(`${id}/extended.json`),
  cells: async (id) => parseCells(read<ExtendedHeader>(`${id}/extended.json`), bin(`${id}/cells.bin`)),
  refined: async (id) => read<RefinedDoc>(`${id}/refined.json`),
}

describe('search panel inputs', () => {
  it('dates: the whole one-year series of the chosen catalogue site; the best equals a direct run', async () => {
    const req = await datesRequest(bySite.Site04R, DEFAULT_SETTINGS, 'minSoc', loaders)
    if ('error' in req) throw new Error(req.error)
    expect(req.kind === 'dates' && [req.fromUtc, req.toUtc]).toEqual(['2026-11-01T00:00:00Z', '2027-10-25T00:00:00Z'])
    if (req.kind === 'dates') expect(req.data.terrain).toBeUndefined() // no 3D data to the worker
    const r = await runSearchRequest(req)
    expect(r.status).toBe('complete')
    const full = { ...bySite.Site04R, ephemeris: await loaders.year('Site04R') }
    expect(r.best!.summary).toEqual(evaluateScenario(full, r.best!.startUtc, DEFAULT_SETTINGS).summary)
  })

  it('places within the two months need no year files; later dates load them', async () => {
    calls.length = 0
    const early = await placesRequest('2026-11-15T00:00:00Z', DEFAULT_SETTINGS, 'earthOutage', bySite, loaders)
    expect(calls).toEqual([])
    expect(early.kind === 'places' && early.catalogue.length).toBe(sites.length)
    const late = await placesRequest('2027-04-15T00:00:00Z', DEFAULT_SETTINGS, 'earthOutage', bySite, loaders)
    expect(calls.length).toBe(sites.length)
    const r = await runSearchRequest(late)
    expect(r.failureCounts.coverage ?? 0).toBe(0)
    expect(r.tested).toBe(sites.length)
  })

  it('places with the map of the chosen site: map points are tested with refined finalists labelled', async () => {
    const req = await placesRequest('2026-11-15T00:00:00Z', DEFAULT_SETTINGS, 'earthOutage', bySite, loaders, { mapOf: 'Site01' })
    expect(req.kind === 'places' && req.coverage).toMatch(/and 3721 map points around Site01/)
    const r = await runSearchRequest(req)
    expect(r.tested).toBe(sites.length + 3721)
    const refined = [...r.feasible, ...r.rejected].find((c) => c.siteId === 'Site01:r36c32')
    expect(refined?.precision ?? 'refined').toBe('refined')
  }, 60000)
})

describe('research goal as the first filter (C → D)', () => {
  const psrs = (JSON.parse(readFileSync(DIR + 'psr-south.json', 'utf8')) as { psrs?: unknown[] }).psrs as never
  it('water ice: places away from a mapped PSR fail with a research reason; passing ones carry the goal fit', async () => {
    const req = await placesRequest('2026-11-15T00:00:00Z', DEFAULT_SETTINGS, 'earthOutage', bySite, loaders, { goal: { type: 'ice', psrs } })
    const r = await runSearchRequest(req, { maxRejected: 100 })
    expect(r.failureCounts.research ?? 0).toBeGreaterThan(0)
    const failed = r.rejected.filter((c) => c.failures[0]?.code === 'research')
    expect(failed.some((c) => c.siteId === 'CE6' || c.siteId.startsWith('Apollo'))).toBe(true)
    expect(failed.every((c) => /^Water-ice sampling/.test(c.failures[0].message))).toBe(true)
    for (const c of r.feasible) expect(c.goalFit?.fit === 'strong' || c.goalFit?.fit === 'possible').toBe(true)
    expect(r.notes.join(' ')).toMatch(/Research goal “Water-ice sampling.*checked first/)
  })
  it('long stay: a date search keeps only starts with the long sunlit stay, re-checked per date', async () => {
    const req = await datesRequest(bySite.Site07, DEFAULT_SETTINGS, 'minSoc', loaders, { type: 'stay', psrs })
    if ('error' in req) throw new Error(req.error)
    const r = await runSearchRequest(req)
    expect(r.failureCounts.research ?? 0).toBeGreaterThan(0) // the dark season fails the goal
    expect(r.feasible.length).toBeGreaterThan(0)
    expect(r.feasible.every((c) => c.goalFit && c.goalFit.fit !== 'no')).toBe(true)
  })
})
