/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellId, isKnownSiteId, needsYear, parseCellId, resolveSiteData, sitesNeeded, snapToCell, type ExtendedState } from '../src/app/extendedSites.ts'
import type { MapDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../src/data/extended.ts'

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
      terrain: { sizeM: 0, n: 0, cellM: 0, zM: [] },
      map: site.category === 'contrast' ? undefined : read<MapDoc>(`${site.id}/map.json`),
    } as SiteData,
  ]),
)
const header = (id: string) => read<ExtendedHeader>(`${id}/extended.json`)
const yearOf = (id: string) => parseYear(id, header(id), readBin(`${id}/year.bin`))
const cellsOf = (id: string) => parseCells(header(id), readBin(`${id}/cells.bin`))
const END = sites.coverage.endUtc

describe('cell ids', () => {
  it('round-trips cell ids', () => {
    expect(cellId('Site04R', 5, 55)).toBe('Site04R:r5c55')
    expect(parseCellId(cellId('Site04R', 5, 55))).toEqual({ siteId: 'Site04R', row: 5, col: 55 })
    expect(parseCellId('Site04R')).toBeNull()
    expect(parseCellId('Site04R:r5')).toBeNull()
    expect(parseCellId(':r1c2')).toBeNull()
  })

  it('isKnownSiteId accepts catalogue sites and in-range cells of map sites only', () => {
    expect(isKnownSiteId('Site01', bySite)).toBe(true)
    expect(isKnownSiteId('Site01:r60c60', bySite)).toBe(true)
    expect(isKnownSiteId('Site01:r61c0', bySite)).toBe(false)
    expect(isKnownSiteId('Site11:r31c0', bySite)).toBe(false)
    expect(isKnownSiteId('CE6:r1c1', bySite)).toBe(false)
    expect(isKnownSiteId('Nowhere', bySite)).toBe(false)
  })

  it('needsYear: every cell, and a plain site only when the mission cannot fit in the two months', () => {
    expect(needsYear('Site01:r1c1', '2026-11-15T00:00:00Z', END)).toBe(true)
    expect(needsYear('Site01', '2026-11-15T00:00:00Z', END)).toBe(false)
    expect(needsYear('Site01', '2026-12-31T00:00:00Z', END)).toBe(false)
    expect(needsYear('Site01', '2026-12-31T00:10:00Z', END)).toBe(true)
    expect(needsYear('Site01', '2027-04-10T00:00:00Z', END)).toBe(true)
  })

  it('sitesNeeded lists base sites once', () => {
    const need = sitesNeeded(
      [
        { siteId: 'Site01:r36c32', startUtc: '2026-11-15T00:00:00Z' },
        { siteId: 'Site07', startUtc: '2027-04-10T00:00:00Z' },
        { siteId: 'Site04', startUtc: '2026-11-15T00:00:00Z' },
        { siteId: 'Site01', startUtc: '2027-02-01T00:00:00Z' },
      ],
      END,
    )
    expect(need.years.sort()).toEqual(['Site01', 'Site07'])
    expect(need.cells).toEqual(['Site01'])
  })
})

describe('resolveSiteData', () => {
  const none: ExtendedState = { years: {}, cells: {} }

  it('a cell is loading until both files are there', () => {
    const id = 'Site01:r36c32'
    expect(resolveSiteData(id, '2026-11-15T00:00:00Z', END, bySite, none)).toEqual({ loading: 'Loading map point…' })
    const ext: ExtendedState = { years: { Site01: yearOf('Site01') }, cells: { Site01: 'loading' } }
    expect(resolveSiteData(id, '2026-11-15T00:00:00Z', END, bySite, ext)).toEqual({ loading: 'Loading map point…' })
    const done: ExtendedState = { years: { Site01: yearOf('Site01') }, cells: { Site01: cellsOf('Site01') } }
    const r = resolveSiteData(id, '2026-11-15T00:00:00Z', END, bySite, done)
    expect('data' in r && r.data.site.id).toBe(id)
    const err: ExtendedState = { years: { Site01: 'error' }, cells: { Site01: cellsOf('Site01') } }
    expect(resolveSiteData(id, '2026-11-15T00:00:00Z', END, bySite, err)).toEqual({ error: 'Map point data not available.' })
  })

  it('a cell of an unknown site or outside the map is an error', () => {
    expect('error' in resolveSiteData('Site01:r99c0', '2026-11-15T00:00:00Z', END, bySite, none)).toBe(true)
    expect('error' in resolveSiteData('CE6:r1c1', '2026-11-15T00:00:00Z', END, bySite, none)).toBe(true)
    expect('error' in resolveSiteData('Nowhere', '2026-11-15T00:00:00Z', END, bySite, none)).toBe(true)
  })

  it('a plain site needing the year falls back to loading, then data', () => {
    const start = '2027-04-10T00:00:00Z'
    expect(resolveSiteData('Site07', start, END, bySite, none)).toEqual({ loading: 'Loading one-year data…' })
    expect(resolveSiteData('Site07', start, END, bySite, { years: { Site07: 'loading' }, cells: {} })).toEqual({ loading: 'Loading one-year data…' })
    expect(resolveSiteData('Site07', start, END, bySite, { years: { Site07: 'error' }, cells: {} })).toEqual({ error: 'One-year data not available.' })
    const r = resolveSiteData('Site07', start, END, bySite, { years: { Site07: yearOf('Site07') }, cells: {} })
    expect('data' in r && r.data.ephemeris.count).toBe(52561)
    expect('data' in r && r.data.horizon).toBe(bySite.Site07.horizon)
  })

  it('a missing year.bin leaves two-month scenarios working', () => {
    const r = resolveSiteData('Site04', '2026-11-15T00:00:00Z', END, bySite, { years: { Site04: 'error' }, cells: {} })
    expect('data' in r && r.data.ephemeris.count).toBe(8785)
    // even when the year is loaded, the two-month (validated, float64) series is used
    const r2 = resolveSiteData('Site04', '2026-11-15T00:00:00Z', END, bySite, { years: { Site04: yearOf('Site04') }, cells: {} })
    expect('data' in r2 && r2.data).toBe(bySite.Site04)
  })
})

describe('snapToCell', () => {
  const m = bySite.Site01.map!
  const i = 36 * 61 + 32

  it('snaps Site01 ridge coordinates to row 36 col 32', () => {
    const s = snapToCell(m.latDeg[i], m.lonDeg[i], bySite)
    expect(s).toMatchObject({ siteId: 'Site01', row: 36, col: 32 })
    expect('distanceM' in s && s.distanceM).toBeLessThan(1)
  })

  it('accepts longitude given as 0–360', () => {
    expect(m.lonDeg[i]).toBeLessThan(0)
    expect(snapToCell(m.latDeg[i], m.lonDeg[i] + 360, bySite)).toMatchObject({ siteId: 'Site01', row: 36, col: 32 })
  })

  it('snaps near the ±180 seam', () => {
    // Site04 lies at lon -171.87; a map cell across the seam must be found from either side
    const m4 = bySite.Site04.map!
    let k = -1
    for (let j = 0; j < m4.lonDeg.length; j++) if (m4.lonDeg[j] > 0) { k = j; break }
    expect(k).toBeGreaterThanOrEqual(0)
    const a = snapToCell(m4.latDeg[k], m4.lonDeg[k], bySite)
    const b = snapToCell(m4.latDeg[k], m4.lonDeg[k] - 360, bySite)
    expect(a).toEqual(b)
    expect('row' in a && a.row * m4.grid.nx + a.col).toBe(k)
  })

  it('rejects a point 10 km away and contrast points', () => {
    const far = snapToCell(m.latDeg[i] + 10000 / 1737400 / (Math.PI / 180), m.lonDeg[i], bySite)
    expect(far).toEqual({ error: 'Outside the ±3 km maps around the polar sites.' })
    const ce6 = bySite.CE6.site
    expect(snapToCell(ce6.latDeg, ce6.lonDeg, bySite)).toEqual({ error: 'Outside the ±3 km maps around the polar sites.' })
    expect('error' in snapToCell(Number.NaN, 0, bySite)).toBe(true)
    expect('error' in snapToCell(-95, 0, bySite)).toBe(true)
  })
})
