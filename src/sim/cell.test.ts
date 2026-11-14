/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MapDoc, SiteData, SitesDoc } from '../data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../data/extended.ts'
import { cellEphemeris, cellSiteData } from './cell.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { marginSeries } from './visibility.ts'

const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const REF = fileURLToPath(new URL('../../docs/reference/cells.json', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

const base = (id: string): SiteData => ({
  site: sites.sites.find((s) => s.id === id)!,
  ephemeris: read(`${id}/ephemeris.json`),
  horizon: read(`${id}/horizon.json`),
  terrain: { sizeM: 0, n: 0, cellM: 0, zM: [] },
  map: read<MapDoc>(`${id}/map.json`),
})
const ext = (id: string) => {
  const header = read<ExtendedHeader>(`${id}/extended.json`)
  return { year: parseYear(id, header, readBin(`${id}/year.bin`)), cells: parseCells(header, readBin(`${id}/cells.bin`)) }
}
const centreOf = (d: SiteData) => ({ latDeg: d.site.latDeg, lonDeg: d.site.lonDeg, eyeM: d.site.surfaceElevationM + d.site.observerHeightM })

interface RefCell { siteId: string; row: number; col: number; index: number; samples: { i: number; sun: { azDeg: number; elDeg: number }; earth: { azDeg: number; elDeg: number } }[] }

describe('cellEphemeris', () => {
  it('matches the Python re-projection (docs/reference/cells.json)', () => {
    const ref = JSON.parse(readFileSync(REF, 'utf8')) as RefCell[]
    expect(ref).toHaveLength(5)
    for (const c of ref) {
      const d = base(c.siteId)
      const { cells } = ext(c.siteId)
      const eph = cellEphemeris(d.ephemeris, centreOf(d), { latDeg: d.map!.latDeg[c.index], lonDeg: d.map!.lonDeg[c.index], eyeM: cells.eyeM[c.index] })
      for (const s of c.samples) {
        for (const b of ['sun', 'earth'] as const) {
          expect(Math.abs(wrap(eph[b].azDeg[s.i] - s[b].azDeg)), `${c.siteId} ${c.row},${c.col} ${b} az @${s.i}`).toBeLessThanOrEqual(0.001)
          expect(Math.abs(eph[b].elDeg[s.i] - s[b].elDeg), `${c.siteId} ${c.row},${c.col} ${b} el @${s.i}`).toBeLessThanOrEqual(0.001)
        }
      }
    }
  })

  it('the centre cell reproduces the site ephemeris', () => {
    const d = base('Site01')
    const eph = cellEphemeris(d.ephemeris, centreOf(d), centreOf(d))
    let max = 0
    for (const b of ['sun', 'earth'] as const) {
      for (let i = 0; i < d.ephemeris.count; i += 7) {
        max = Math.max(max, Math.abs(wrap(eph[b].azDeg[i] - d.ephemeris[b].azDeg[i])), Math.abs(eph[b].elDeg[i] - d.ephemeris[b].elDeg[i]))
      }
    }
    expect(max).toBeLessThanOrEqual(1e-6)
  })
})

describe('cellSiteData', () => {
  const MAP_SITES = ['Site01', 'Site04', 'Site04R', 'Site07', 'Site11', 'Site20', 'Site23']
  const FIXED = [[5, 5], [5, 55], [55, 5], [55, 55], [30, 10], [36, 32]]

  it('cell percentages over the two months match map.json within 0.2 points', () => {
    for (const id of MAP_SITES) {
      const d = base(id)
      const { year, cells } = ext(id)
      const nx = d.map!.grid.nx
      const k = nx === 61 ? 1 : 2
      const list = [[nx >> 1, nx >> 1], ...FIXED.map(([r, c]) => [Math.floor(r / k), Math.floor(c / k)])]
      const n = d.ephemeris.count
      for (const [r, c] of list) {
        const cell = cellSiteData(d, year, cells, r, c)
        const sun = marginSeries(cell.ephemeris.sun, cell.horizon, 0, n)
        const earth = marginSeries(cell.ephemeris.earth, cell.horizon, 0, n)
        let s = 0
        let e = 0
        let both = 0
        for (let i = 0; i < n; i++) {
          s += sun[i] > 0 ? 1 : 0
          e += earth[i] > 0 ? 1 : 0
          both += sun[i] > 0 && earth[i] > 0 ? 1 : 0
        }
        const i = r * nx + c
        expect(Math.abs((100 * s) / n - d.map!.sunPct[i]), `${id} ${r},${c} sun`).toBeLessThanOrEqual(0.2)
        expect(Math.abs((100 * e) / n - d.map!.earthPct[i]), `${id} ${r},${c} earth`).toBeLessThanOrEqual(0.2)
        expect(Math.abs((100 * both) / n - d.map!.bothPct[i]), `${id} ${r},${c} both`).toBeLessThanOrEqual(0.2)
      }
    }
  })

  it('labels the cell and keeps the base site data', () => {
    const d = base('Site01')
    const { year, cells } = ext('Site01')
    const cell = cellSiteData(d, year, cells, 36, 32)
    expect(cell.site.id).toBe('Site01:r36c32')
    expect(cell.site.name).toBe('Connecting Ridge — map point')
    expect(cell.site.label).toBe('Regional map point (1° horizon), not a catalogue site')
    expect(cell.site.derivedFrom).toBe('Site01')
    expect(cell.site.warnings).toEqual([])
    expect(cell.site.derivation).toBe('regional map cell row 36, col 32 (200 m east, 600 m north of the site centre); 1° terrain horizon')
    expect(cell.site.coordSource).toBe('Regional map of Site01 (map.json cell centre)')
    const ridgeCell = cellSiteData(base('Site04R'), ext('Site04R').year, ext('Site04R').cells, 30, 30)
    expect(ridgeCell.site.derivation).toMatch(/^regional map cell row 30, col 30 \(site centre\)/)
    expect(cell.site.latDeg).toBe(d.map!.latDeg[36 * 61 + 32])
    expect(cell.horizon.azStepDeg).toBe(1)
    expect(cell.horizon.distanceM).toBeUndefined()
    expect(cell.ephemeris.count).toBe(year.count)
    expect(cell.map).toBe(d.map)
    expect(() => cellSiteData(d, year, cells, 61, 0)).toThrow(RangeError)
  })

  it('cell scenario evaluates in April 2027', () => {
    const d = base('Site07')
    const { year, cells } = ext('Site07')
    const result = evaluateScenario(cellSiteData(d, year, cells, 55, 5), '2027-04-10T00:00:00Z', DEFAULT_SETTINGS)
    expect(result.count).toBeGreaterThan(0)
    expect(result.siteId).toBe('Site07:r55c5')
  })
})

