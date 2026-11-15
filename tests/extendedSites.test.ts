/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellId, isKnownSiteId, needsYear, parseCellId, resolveSiteData, sitesNeeded, snapToCell, type ExtendedState } from '../src/app/extendedSites.ts'
import type { MapDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'

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

  it('needsYear: a mission that starts in the two months but ends after them needs the year', () => {
    expect(needsYear('Site01', '2026-12-28T00:00:00Z', END, 7)).toBe(true)
    expect(needsYear('Site01', '2026-12-25T00:00:00Z', END, 7)).toBe(false)
    expect(needsYear('Site01', '2026-12-02T00:00:00Z', END, 30)).toBe(false)
    expect(needsYear('Site01', '2026-12-03T00:00:00Z', END, 30)).toBe(true)
  })

  it('a mission crossing the two-month end evaluates once the year is loaded', () => {
    const start = '2026-12-28T00:00:00Z'
    const ext: ExtendedState = { years: { Site01: yearOf('Site01') }, cells: {} }
    const r = resolveSiteData('Site01', start, END, bySite, ext, 7)
    expect('data' in r && r.data.ephemeris.count).toBe(52561)
    expect(resolveSiteData('Site01', start, END, bySite, { years: {}, cells: {} }, 7)).toEqual({ loading: 'Loading one-year data…' })
    expect(sitesNeeded([{ siteId: 'Site04', startUtc: start }], END, 7).years).toEqual(['Site04'])
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
    const done: ExtendedState = { years: { Site01: yearOf('Site01') }, cells: { Site01: cellsOf('Site01') }, headers: { Site01: header('Site01') } }
    const r = resolveSiteData(id, '2026-11-15T00:00:00Z', END, bySite, done)
    expect('data' in r && r.data.site.id).toBe(id)
    const err: ExtendedState = { years: { Site01: 'error' }, cells: { Site01: cellsOf('Site01') }, headers: { Site01: header('Site01') } }
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

describe('acceptance: coverage limits and failure modes', () => {
  const settings = { ...DEFAULT_SETTINGS, durationDays: 1 }
  const yearData = () => {
    const r = resolveSiteData('Site01', '2027-10-31T00:00:00Z', END, bySite, { years: { Site01: yearOf('Site01') }, cells: {} }, 1)
    if (!('data' in r)) throw new Error('year data expected')
    return r.data
  }

  it('start + duration exactly at 2027-11-01T00:00:00Z is accepted', () => {
    const r = evaluateScenario(yearData(), '2027-10-31T00:00:00Z', settings)
    expect(r.count).toBe(145)
    expect(r.startIndex + r.count - 1).toBe(yearData().ephemeris.count - 1)
  })

  it('600 s later throws CoverageError naming 2027-11-01', () => {
    const run = () => evaluateScenario(yearData(), '2027-10-31T00:10:00Z', settings)
    expect(run).toThrow(CoverageError)
    expect(run).toThrow(/2027-11-01/)
  })

  it('snapToCell(-89.4632, 180.0001) and (-89.4632, -179.9999) agree', () => {
    expect(snapToCell(-89.4632, 180.0001, bySite)).toEqual(snapToCell(-89.4632, -179.9999, bySite))
  })

  it('±180° wrap: a synthetic map centred on the seam snaps both sides to the same cell', () => {
    // 3x3 map, lat -89.46, columns at lon 179.65, 180 and -179.65 (about 100 m apart at this latitude)
    const lons = [179.65, 180, -179.65]
    const latDeg: number[] = []
    const lonDeg: number[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { latDeg.push(-89.46 + (r - 1) * 0.0009); lonDeg.push(lons[c]) }
    const base = bySite.Site01
    const seam = { ...base, site: { ...base.site, id: 'Seam' }, map: { ...base.map!, siteId: 'Seam', grid: { nx: 3, ny: 3, spacingM: 100, halfSizeM: 100 }, latDeg, lonDeg } } as SiteData
    const only = { Seam: seam }
    const a = snapToCell(-89.46, 180.0001, only)
    const b = snapToCell(-89.46, -179.9999, only)
    expect(a).toMatchObject({ siteId: 'Seam', row: 1, col: 1 })
    expect(b).toMatchObject({ siteId: 'Seam', row: 1, col: 1 })
    expect(snapToCell(-89.46, 180.3, only)).toMatchObject({ row: 1, col: 2 })
    expect(snapToCell(-89.46, -179.7, only)).toMatchObject({ row: 1, col: 2 })
    expect(snapToCell(-89.46, 179.7, only)).toMatchObject({ row: 1, col: 0 })
  })

  it('missing cells.bin shows an error, not a zero horizon', () => {
    const missing: ExtendedState = { years: { Site01: yearOf('Site01') }, cells: { Site01: 'error' }, headers: { Site01: header('Site01') } }
    expect(resolveSiteData('Site01:r36c32', '2026-11-15T00:00:00Z', END, bySite, missing)).toEqual({ error: 'Map point data not available.' })
    expect(() => parseCells(header('Site01'), new ArrayBuffer(0))).toThrow(/Site01\/cells\.bin/)
  })
})
