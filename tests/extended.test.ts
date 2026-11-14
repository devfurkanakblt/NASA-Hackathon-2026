/// <reference types="node" />
/**
 * One-year ephemeris (`year.bin`) and per-cell horizons (`cells.bin`) on the real files:
 * the year series must reproduce the validated two-month series and the season table.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EphemerisDoc, HorizonDoc, SeasonDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { cellHorizon, loadCells, loadYear, parseCells, parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'
import { marginSeries } from '../src/sim/visibility.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const year = (id: string): EphemerisDoc => parseYear(id, read<ExtendedHeader>(`${id}/extended.json`), readBin(`${id}/year.bin`))
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

describe('year.bin', () => {
  it('year series reproduces ephemeris.json over the two months', () => {
    for (const { id } of sites.sites) {
      const y = year(id)
      const e = read<EphemerisDoc>(`${id}/ephemeris.json`)
      expect(y.startUtc).toBe(e.startUtc)
      expect(y.stepS).toBe(e.stepS)
      expect(y.count).toBe(52561)
      let maxAz = 0
      let maxEl = 0
      for (const b of ['sun', 'earth'] as const) {
        for (let i = 0; i < e.count; i++) {
          maxAz = Math.max(maxAz, Math.abs(wrap(y[b].azDeg[i] - e[b].azDeg[i])))
          maxEl = Math.max(maxEl, Math.abs(y[b].elDeg[i] - e[b].elDeg[i]))
        }
      }
      expect(maxAz, id).toBeLessThanOrEqual(1e-4)
      expect(maxEl, id).toBeLessThanOrEqual(1e-4)
    }
  })

  it('year series gives season.json monthly percentages', () => {
    for (const id of ['Site01', 'Site07', 'CE6']) {
      const y = year(id)
      const hz = read<HorizonDoc>(`${id}/horizon.json`)
      const season = read<SeasonDoc>(`${id}/season.json`)
      for (const m of season.months) {
        const n = m.endIndex - m.startIndex
        const sun = marginSeries(y.sun, hz, m.startIndex, n)
        const earth = marginSeries(y.earth, hz, m.startIndex, n)
        let s = 0
        let e = 0
        let both = 0
        for (let k = 0; k < n; k++) {
          s += sun[k] > 0 ? 1 : 0
          e += earth[k] > 0 ? 1 : 0
          both += sun[k] > 0 && earth[k] > 0 ? 1 : 0
        }
        expect(Math.abs((100 * s) / n - m.sunPct), `${id} ${m.month} sun`).toBeLessThanOrEqual(0.01)
        expect(Math.abs((100 * e) / n - m.earthPct), `${id} ${m.month} earth`).toBeLessThanOrEqual(0.01)
        expect(Math.abs((100 * both) / n - m.bothPct), `${id} ${m.month} both`).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('a mission past the year end throws CoverageError naming 2027-11-01', () => {
    const base: SiteData = {
      site: sites.sites.find((s) => s.id === 'Site01')!,
      ephemeris: year('Site01'),
      horizon: read('Site01/horizon.json'),
      terrain: { sizeM: 0, n: 0, cellM: 0, zM: [] },
    }
    const run = () => evaluateScenario(base, '2027-10-30T00:00:00Z', { ...DEFAULT_SETTINGS, durationDays: 7 })
    expect(run).toThrow(CoverageError)
    expect(run).toThrow(/2027-11-01/)
    // and a mission in April 2027 now works
    expect(evaluateScenario(base, '2027-04-10T00:00:00Z', DEFAULT_SETTINGS).count).toBeGreaterThan(0)
  })
})

describe('cells.bin', () => {
  it('cellHorizon gives the 1° horizon of a cell without distances', () => {
    const header = read<ExtendedHeader>('Site01/extended.json')
    const cells = parseCells(header, readBin('Site01/cells.bin'))
    expect(cells.n).toBe(3721)
    expect(cells.eyeM).toHaveLength(3721)
    const h = cellHorizon(cells, 36 * 61 + 32)
    expect(h.azStepDeg).toBe(1)
    expect(h.count).toBe(360)
    expect(h.elevDeg).toHaveLength(360)
    expect(h.distanceM).toBeUndefined()
    const centre = cellHorizon(cells, 30 * 61 + 30)
    const site = read<HorizonDoc>('Site01/horizon.json')
    // centre cell: every 10th 0.1° value of horizon.json is the same azimuth, within the 0.5° map ray step
    let max = 0
    for (let j = 0; j < 360; j++) max = Math.max(max, Math.abs(centre.elevDeg[j] - site.elevDeg[j * 10]))
    expect(max).toBeLessThan(0.05)
  })
})

describe('loaders', () => {
  afterEach(() => vi.unstubAllGlobals())

  const header = { version: 1, siteId: 'X', year: { file: 'year.bin', startUtc: '2026-11-01T00:00:00Z', stepS: 600, count: 2, source: 'test' } }
  const yearBuf = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer

  it('loadYear rejects with the file name when year.bin is missing, and a later call retries', async () => {
    let yearOk = false
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      if (url.endsWith('extended.json')) return { ok: true, status: 200, json: async () => header }
      if (url.endsWith('year.bin') && yearOk) return { ok: true, status: 200, arrayBuffer: async () => yearBuf }
      return { ok: false, status: 404 }
    })
    await expect(loadYear('X', 'd1')).rejects.toThrow('d1/X/year.bin')
    yearOk = true
    const y = await loadYear('X', 'd1')
    expect(y.sun.azDeg).toEqual([1, 2])
    expect(y.earth.distanceM).toEqual([11, 12])
    expect(y.source).toBe('test')
    // cached: no new request
    const n = calls.length
    await loadYear('X', 'd1')
    expect(calls.length).toBe(n)
  })

  it('loadCells rejects when the site has no cells', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('extended.json') ? { ok: true, status: 200, json: async () => header } : { ok: false, status: 404 })
    await expect(loadCells('X', 'd2')).rejects.toThrow(/no map cells/)
  })
})
