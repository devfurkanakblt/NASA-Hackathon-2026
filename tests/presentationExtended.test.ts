/// <reference types="node" />
/**
 * The two stories added with the one-year and map-point scope, on the real data, so the numbers
 * in docs/presentation-notes.md ("Story 2" and "Story 3") stay what the app shows:
 * - a map point 630 m from the Site01 catalogue point sees Earth far more often;
 * - the same site in April 2027 instead of November 2026 loses the Sun and its battery reserve.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveSiteData } from '../src/app/extendedSites.ts'
import type { ExtendedState } from '../src/app/extendedSites.ts'
import type { MapDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseCells, parseYear } from '../src/data/extended.ts'
import type { ExtendedHeader } from '../src/data/extended.ts'
import { J_PER_WH } from '../src/sim/energy.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const bySite: Record<string, SiteData> = Object.fromEntries(
  sites.sites.map((site) => [
    site.id,
    {
      site,
      ephemeris: read(`${site.id}/ephemeris.json`),
      horizon: read(`${site.id}/horizon.json`),
      map: site.category === 'contrast' ? undefined : read<MapDoc>(`${site.id}/map.json`),
    } as SiteData,
  ]),
)
const ext: ExtendedState = { years: {}, cells: {}, headers: {} }
for (const id of ['Site01', 'Site04R', 'Site07']) {
  const header = read<ExtendedHeader>(`${id}/extended.json`)
  ext.headers![id] = header
  ext.years[id] = parseYear(id, header, readBin(`${id}/year.bin`))
  ext.cells[id] = parseCells(header, readBin(`${id}/cells.bin`))
}

function run(id: string, startUtc: string) {
  const r = resolveSiteData(id, startUtc, sites.coverage.endUtc, bySite, ext, DEFAULT_SETTINGS.durationDays)
  if (!('data' in r)) throw new Error(`${id} ${startUtc}: ${JSON.stringify(r)}`)
  return { site: r.data.site, s: evaluateScenario(r.data, startUtc, DEFAULT_SETTINGS).summary }
}
const pct = (f: number) => Math.round(f * 1000) / 10
const hours = (s: number) => Math.round(s / 360) / 10
const NOV = '2026-11-15T00:00:00Z'
const APR = '2027-04-15T00:00:00Z'

describe('story 2: a map point 630 m from the catalogue point (15 Nov 2026, 7 days)', () => {
  it('Site01 catalogue point: Earth 46.4 %, longest outage 90 h', () => {
    const { s } = run('Site01', NOV)
    expect([pct(s.sunVisibleFraction), pct(s.earthVisibleFraction), hours(s.longestEarthOutageS), s.keepsBatteryReserve]).toEqual([100, 46.4, 90, true])
  })

  it('map point Site01:r36c32 (200 m east, 600 m north): Earth 78.2 %, longest outage 36.7 h', () => {
    const { site, s } = run('Site01:r36c32', NOV)
    expect(site.label).toBe('Regional screening estimate (1° horizon), not a catalogue site')
    expect([pct(s.sunVisibleFraction), pct(s.earthVisibleFraction), hours(s.longestEarthOutageS), s.keepsBatteryReserve]).toEqual([100, 78.2, 36.7, true])
  })
})

describe('story 3: the same site in another season (7 days)', () => {
  it('Site04R keeps its reserve in November but not in April 2027', () => {
    const nov = run('Site04R', NOV).s
    const apr = run('Site04R', APR).s
    expect([pct(nov.sunVisibleFraction), nov.keepsBatteryReserve]).toEqual([100, true])
    expect([pct(apr.sunVisibleFraction), pct(apr.earthVisibleFraction), apr.keepsBatteryReserve, hours(apr.firstReserveViolationS ?? 0)]).toEqual([31.2, 11.6, false, 68.2])
    expect(apr.unmetEnergyJ / J_PER_WH / 1000).toBeCloseTo(18.2, 1)
  })

  it('Site07: continuous Sun in November, almost none in April 2027', () => {
    const nov = run('Site07', NOV).s
    const apr = run('Site07', APR).s
    expect([pct(nov.sunVisibleFraction), nov.keepsBatteryReserve]).toEqual([100, true])
    expect([pct(apr.sunVisibleFraction), apr.keepsBatteryReserve]).toEqual([0.2, false])
    expect(apr.unmetEnergyJ / J_PER_WH / 1000).toBeCloseTo(33.1, 1)
  })
})
