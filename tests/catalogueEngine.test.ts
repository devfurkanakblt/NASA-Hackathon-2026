/// <reference types="node" />
/**
 * D support for A's catalogue extension (madde 1): every published site runs through the engine
 * on its two-month and one-year series, the one-year last valid start passes and one step later
 * is refused, and a date search over the extended catalogue completes with labelled results.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario, missionStartRange } from '../src/sim/evaluate.ts'
import { cataloguePlaces, findPlacesForDate } from '../src/sim/search.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DATA + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json').sites
const data = (id: string): SiteData => ({ site: sites.find((s) => s.id === id)!, ephemeris: read(`${id}/ephemeris.json`), horizon: read(`${id}/horizon.json`) })

describe('extended catalogue in the engine', () => {
  it('has the published sites, all in the southern hemisphere (catalogue limited by A, PR #39)', () => {
    expect(sites.length).toBeGreaterThan(9)
    expect(sites.every((s) => s.latDeg < 0)).toBe(true)
  })

  it('every site: default mission, and the one-year last valid start passes / +600 s is refused', () => {
    for (const s of sites) {
      const d = data(s.id)
      const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
      expect(Number.isFinite(r.summary.minSocFraction), s.id).toBe(true)
      if (!existsSync(`${DATA}${s.id}/year.bin`)) continue
      const year = parseYear(s.id, read<ExtendedHeader>(`${s.id}/extended.json`), bin(`${s.id}/year.bin`))
      const full = { ...d, ephemeris: year }
      const range = missionStartRange(year, 7)!
      expect(range.lastStartUtc, s.id).toBe('2027-10-25T00:00:00Z')
      expect(evaluateScenario(full, range.lastStartUtc, DEFAULT_SETTINGS).count, s.id).toBe(1009)
      expect(() => evaluateScenario(full, '2027-10-25T00:10:00Z', DEFAULT_SETTINGS), s.id).toThrow(CoverageError)
    }
  })

  it('places for a date over the whole catalogue: complete, every site tested, labelled', async () => {
    const r = await findPlacesForDate({ places: cataloguePlaces(sites.map((s) => data(s.id))), settings: DEFAULT_SETTINGS, startUtc: '2026-11-18T00:00:00Z', sortBy: 'earthOutage' }, { maxRejected: 40 })
    expect(r.status).toBe('complete')
    expect(r.tested).toBe(sites.length)
    // every site is either feasible or rejected with a named reason; none silently dropped
    expect([...r.feasible, ...r.rejected].map((c) => c.siteId).sort()).toEqual(sites.map((s) => s.id).sort())
    expect(r.rejected.every((c) => c.failures.length > 0 && c.failures.every((f) => f.message.length > 0))).toBe(true)
    expect(r.failureCounts.data ?? 0).toBe(0)
    expect(r.feasible.every((c) => /0.1° terrain horizon/.test(c.precisionLabel))).toBe(true)
    if (r.best) expect(r.best.summary).toEqual(evaluateScenario(data(r.best.siteId), r.best.startUtc, DEFAULT_SETTINGS).summary)
  })
})
