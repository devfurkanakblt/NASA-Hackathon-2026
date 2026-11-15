/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EphemerisDoc, HorizonDoc, MapDoc, SeasonDoc, SiteData, SitesDoc } from '../data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../data/extended.ts'
import { cellSiteData } from './cell.ts'
import { seasonFromSeries } from './season.ts'

const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const header = (id: string) => read<ExtendedHeader>(`${id}/extended.json`)
const year = (id: string): EphemerisDoc => parseYear(id, header(id), readBin(`${id}/year.bin`))

describe('seasonFromSeries', () => {
  it('reproduces season.json of the catalogue sites from year.bin + horizon.json', () => {
    for (const id of ['Site01', 'Site04R', 'Site07', 'CE6']) {
      const want = read<SeasonDoc>(`${id}/season.json`)
      const got = seasonFromSeries(year(id), read<HorizonDoc>(`${id}/horizon.json`))
      expect(got.coverage).toEqual(want.coverage)
      expect(got.months.map((m) => m.month)).toEqual(want.months.map((m) => m.month))
      // year.bin is float32: percentages may differ by a sample, durations by a step.
      const close = (a: SeasonDoc['year'], b: SeasonDoc['year'], what: string) => {
        expect(a.samples, what).toBe(b.samples)
        for (const k of ['sunPct', 'earthPct', 'bothPct'] as const) expect(Math.abs(a[k] - b[k]), `${what} ${k}`).toBeLessThanOrEqual(0.03)
        expect(Math.abs(a.sunDiskFractionMean - b.sunDiskFractionMean), `${what} disk`).toBeLessThanOrEqual(0.001)
        for (const k of ['longestNoSunS', 'longestNoEarthS'] as const) expect(Math.abs(a[k] - b[k]), `${what} ${k}`).toBeLessThanOrEqual(600)
        for (const k of ['sunElMaxDeg', 'sunElMinDeg', 'earthElMaxDeg'] as const) expect(Math.abs(a[k] - b[k]), `${what} ${k}`).toBeLessThanOrEqual(0.002)
      }
      close(got.year, want.year, `${id} year`)
      close(got.mainPeriod, want.mainPeriod, `${id} mainPeriod`)
      expect(got.mainPeriod.endUtc).toBe(want.mainPeriod.endUtc)
      got.months.forEach((m, i) => {
        expect([m.startIndex, m.endIndex]).toEqual([want.months[i].startIndex, want.months[i].endIndex])
        close(m, want.months[i], `${id} ${m.month}`)
      })
    }
  })

  it('refuses non-finite data instead of counting it as hidden', () => {
    const y = year('Site01')
    const hz = read<HorizonDoc>('Site01/horizon.json')
    const bad = { ...y, sun: { ...y.sun, elDeg: y.sun.elDeg.map((v, i) => (i === 100 ? Number.NaN : v)) } }
    expect(() => seasonFromSeries(bad, hz)).toThrow(/non-finite/)
  })
})

describe('cell season', () => {
  const base = (id: string): SiteData => ({
    site: sites.sites.find((s) => s.id === id)!,
    ephemeris: read(`${id}/ephemeris.json`),
    horizon: read(`${id}/horizon.json`),
    terrain: { sizeM: 0, n: 0, cellM: 0, zM: [] },
    season: read<SeasonDoc>(`${id}/season.json`),
    map: read<MapDoc>(`${id}/map.json`),
  })

  it('Site01:r36c32 gets its own yearly summary, not the catalogue centre’s', () => {
    const d = base('Site01')
    const y = year('Site01')
    const cells = parseCells(header('Site01'), readBin('Site01/cells.bin'))
    const cell = cellSiteData(d, y, cells, 36, 32)
    expect(cell.season).not.toBe(d.season)
    expect(cell.season!.siteId).toBe('Site01:r36c32')
    // Values from the C/B finding (docs/ekip-notlari.md): centre 47.4 / 40.03, cell 65.84 / 50.90.
    expect(d.season!.year.sunPct).toBe(47.4)
    expect(cell.season!.year.sunPct).toBeCloseTo(65.84, 1)
    expect(cell.season!.year.earthPct).toBeCloseTo(50.9, 1)
    expect(cell.season!.months).toHaveLength(12)
    // computed once per cell
    expect(cellSiteData(d, y, cells, 36, 32).season).toBe(cell.season)
    expect(cellSiteData(d, y, cells, 36, 33).season).not.toBe(cell.season)
  })

  it('a contradicting cells.bin size is refused', () => {
    const d = base('Site01')
    const cells = parseCells(header('Site01'), readBin('Site01/cells.bin'))
    expect(() => cellSiteData(d, year('Site01'), { ...cells, n: cells.n - 1 }, 0, 0)).toThrow(/cells/)
  })
})
