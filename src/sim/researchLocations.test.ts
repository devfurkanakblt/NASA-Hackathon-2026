/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SiteData, SitesDoc } from '../data/contract.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { RESEARCH_TYPES, researchMetrics, type ResearchMetrics } from './research.ts'
import { findResearchLocations, rankResearchLocations, type ResearchLocation } from './researchLocations.ts'

const metrics: ResearchMetrics = {
  siteId: 'selected', latDeg: -89, lonDeg: 0, durationS: 7 * 86400,
  sunFraction: 0.5, earthFraction: 0.5, bothFraction: 0.3,
  longestSunS: 4 * 86400, longestEarthS: 4 * 86400, longestBothS: 3.5 * 86400,
  psrEdgeKm: 1, psrName: 'test', slopeDeg: null, earthYearPct: null, region: 'polar',
}
const candidate = (siteId: string, patch: Partial<ResearchMetrics> = {}): ResearchLocation => ({
  metrics: { ...metrics, siteId, latDeg: -85, ...patch }, name: siteId, precisionLabel: 'test', failures: [],
})

describe('per-research location ranking', () => {
  it('ranks the same places differently for ice, sunlight and Earth contact', () => {
    const a = candidate('ice', { psrEdgeKm: 0.1, longestSunS: 3.5 * 86400, longestEarthS: 4 * 86400 })
    const b = candidate('sun', { psrEdgeKm: 8, longestSunS: 7 * 86400, longestEarthS: 3 * 86400 })
    const c = candidate('earth', { psrEdgeKm: 5, longestSunS: 4 * 86400, longestEarthS: 7 * 86400 })
    const list = [a, b, c]
    for (const [id, winner] of [['ice', 'ice'], ['stay', 'sun'], ['comms', 'earth']]) {
      expect(rankResearchLocations(RESEARCH_TYPES.find(t => t.id === id)!, metrics, list)[0].metrics.siteId).toBe(winner)
    }
  })
  it('excludes the selected coordinate, northern points and known steep terrain', () => {
    const list = [candidate('same', { latDeg: -89, lonDeg: 0 }), candidate('north', { latDeg: 10 }), candidate('steep', { slopeDeg: 15 }), candidate('valid')]
    expect(rankResearchLocations(RESEARCH_TYPES[0], metrics, list).map(c => c.metrics.siteId)).toEqual(['valid'])
  })
  it('shows ties and inferior alternatives honestly and keeps hardware failures visible', () => {
    const equal = candidate('equal')
    equal.failures = [{ code: 'earthOutage', message: 'Needs a relay.' }]
    const ranked = rankResearchLocations(RESEARCH_TYPES[0], metrics, [equal, candidate('worse', { psrEdgeKm: 8, lonDeg: 20 })])
    expect(ranked.map(c => c.comparison)).toEqual(['equal', 'lower'])
    expect(ranked[0].failures).toEqual(equal.failures)
    expect(ranked[0].distanceKm).toBeGreaterThan(0)
  })
  it('does not claim full-year radio shielding from a mission-only result', () => {
    const ranked = rankResearchLocations(RESEARCH_TYPES.find(t => t.id === 'radio')!, metrics, [candidate('radio', { earthFraction: 0, earthYearPct: null })])
    expect(ranked[0].fit).toBe('possible')
  })
})

afterEach(() => vi.unstubAllGlobals())

it('finds per-type southern locations using real terrain, with PSR seeds and rechecked finalists', async () => {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    try { return new Response(readFileSync(fileURLToPath(new URL(`../../public/${String(url).replace(/^\//, '')}`, import.meta.url))), { status: 200 }) }
    catch { return new Response('Missing test data', { status: 404 }) }
  })
  const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)), 'utf8'))
  const sites = read('sites.json') as SitesDoc
  const reference: SiteData = { site: sites.sites.find(s => s.id === 'Site01')!, ephemeris: read('Site01/ephemeris.json'), horizon: read('Site01/horizon.json') }
  const psrs = read('psr-south.json').psrs.slice(0, 3)
  const startUtc = '2026-11-05T00:00:00Z'
  const result = evaluateScenario(reference, startUtc, DEFAULT_SETTINGS)
  const selected = researchMetrics(reference, result, psrs)
  const input = { reference, catalogue: [reference], selected, psrs, startUtc, settings: DEFAULT_SETTINGS, typeIds: ['ice', 'stay', 'comms'] as const }
  const found = await findResearchLocations({ ...input, typeIds: [...input.typeIds] })
  expect(found.testedLocations).toBeGreaterThan(150)
  expect(Object.keys(found.rankings).sort()).toEqual(['comms', 'ice', 'stay'])
  expect(found.rankings.ice!.length).toBeGreaterThan(0)
  expect(found.rankings.comms!.length).toBeGreaterThan(0)
  for (const type of RESEARCH_TYPES.filter(t => input.typeIds.some(id => id === t.id))) {
    const options = found.rankings[type.id]!
    expect(options.every(c => c.metrics.latDeg < 0 && c.metrics.siteId !== selected.siteId && type.assess(c.metrics).fit !== 'no')).toBe(true)
    expect(options.every(c => c.precisionLabel.includes('0.1'))).toBe(true)
  }
  const controller = new AbortController(); controller.abort()
  await expect(findResearchLocations({ ...input, typeIds: [...input.typeIds] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
}, 120000)
