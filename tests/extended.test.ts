/// <reference types="node" />
/**
 * One-year ephemeris (`year.bin`) and per-cell horizons (`cells.bin`) on the real files:
 * the year series must reproduce the validated two-month series and the season table.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EphemerisDoc, HorizonDoc, SeasonDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import {
  cellHorizon, loadCells, loadYear, parseCells, parseYear, SUPPORTED_EXTENDED_SCHEMA, validateExtendedHeader, type ExtendedHeader,
} from '../src/data/extended.ts'
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

const FIELDS = ['sun.azDeg', 'sun.elDeg', 'sun.distanceM', 'earth.azDeg', 'earth.elDeg', 'earth.distanceM']
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeHeader(siteId: string, count: number, withCells = false): Record<string, any> {
  const end = new Date(Date.UTC(2026, 10, 1) + (count - 1) * 600 * 1000).toISOString().replace('.000Z', 'Z')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h: Record<string, any> = {
    version: 1,
    extendedSchema: 2,
    siteId,
    year: {
      file: 'year.bin', sha256: 'a'.repeat(64), startUtc: '2026-11-01T00:00:00Z', endUtc: end, stepS: 600, count, source: 'test',
      observer: { latDeg: -89, lonDeg: 10, eyeM: 2 }, fields: [...FIELDS],
    },
  }
  if (withCells) {
    h.cells = {
      file: 'cells.bin', sha256: 'b'.repeat(64), azStartDeg: 0, azStepDeg: 1, count: 360, coverageDeg: 360, unitDeg: 0.01,
      horizonResolutionDeg: 1, n: 2, eyeM: [1, 2], grid: { nx: 2, ny: 1, spacingM: 100, halfSizeM: 100 },
    }
  }
  return h
}
const issues = (h: unknown, id = 'Site01') => validateExtendedHeader(h, id)

describe('validateExtendedHeader', () => {
  const hdr = makeHeader('Site01', 3, true)
  it('accepts a well-formed header', () => expect(issues(hdr)).toEqual([]))
  it('exports the supported schema', () => expect(SUPPORTED_EXTENDED_SCHEMA).toBe(2))
  it('rejects non-objects', () => expect(issues(null)[0]).toMatch(/Site01\/extended\.json/))
  it('rejects a header from another site', () => expect(issues({ ...hdr, siteId: 'Site04' })).toContainEqual(expect.stringMatching(/siteId/)))
  it('rejects an unsupported schema', () => expect(issues({ ...hdr, extendedSchema: 1 }).length).toBeGreaterThan(0))
  it('names Site01/extended.json in every message', () => {
    for (const m of issues({ ...hdr, extendedSchema: 1, siteId: 'x' })) expect(m).toContain('Site01/extended.json')
  })
  it('rejects stepS other than 600', () => expect(issues({ ...hdr, year: { ...hdr.year, stepS: 300 } })).toContainEqual(expect.stringMatching(/stepS/)))
  it('rejects an unparsable startUtc', () => expect(issues({ ...hdr, year: { ...hdr.year, startUtc: 'soon' } })).toContainEqual(expect.stringMatching(/startUtc/)))
  it('rejects endUtc other than start + (count-1)*stepS', () =>
    expect(issues({ ...hdr, year: { ...hdr.year, endUtc: '2027-11-01T00:00:00Z' } })).toContainEqual(expect.stringMatching(/endUtc/)))
  it('rejects a non-integer count', () => expect(issues({ ...hdr, year: { ...hdr.year, count: 2.5 } }).length).toBeGreaterThan(0))
  it('rejects fields in another order', () => {
    const f = [...FIELDS]
    ;[f[0], f[1]] = [f[1], f[0]]
    expect(issues({ ...hdr, year: { ...hdr.year, fields: f } })).toContainEqual(expect.stringMatching(/fields/))
  })
  it('rejects a bad sha256', () => expect(issues({ ...hdr, year: { ...hdr.year, sha256: 'xyz' } })).toContainEqual(expect.stringMatching(/sha256/)))
  it('rejects cells whose azStepDeg*count is not 360', () =>
    expect(issues({ ...hdr, cells: { ...hdr.cells, azStepDeg: 2 } })).toContainEqual(expect.stringMatching(/azStepDeg/)))
  it('rejects cells whose azStartDeg is not 0', () =>
    expect(issues({ ...hdr, cells: { ...hdr.cells, azStartDeg: 5 } })).toContainEqual(expect.stringMatching(/azStartDeg/)))
  it('rejects eyeM of the wrong length', () =>
    expect(issues({ ...hdr, cells: { ...hdr.cells, eyeM: [1] } })).toContainEqual(expect.stringMatching(/eyeM/)))
  it('rejects a non-finite eyeM value', () =>
    expect(issues({ ...hdr, cells: { ...hdr.cells, eyeM: [1, null] } })).toContainEqual(expect.stringMatching(/eyeM/)))
  it('rejects a non-positive unitDeg', () => expect(issues({ ...hdr, cells: { ...hdr.cells, unitDeg: 0 } })).toContainEqual(expect.stringMatching(/unitDeg/)))
  it('accepts a header without cells', () => expect(issues(makeHeader('Site01', 3))).toEqual([]))
  it('the real Site01 header passes validation', () => expect(validateExtendedHeader(read('Site01/extended.json'), 'Site01')).toEqual([]))
  it('every real header passes validation', () => {
    for (const { id } of sites.sites) {
      if (existsSync(DATA_DIR + `${id}/extended.json`)) expect(validateExtendedHeader(read(`${id}/extended.json`), id), id).toEqual([])
    }
  })
})

describe('strict binary parsing', () => {
  const yh = makeHeader('Site01', 3) as unknown as ExtendedHeader
  const yearBuf = (bad?: number) => {
    const f = new Float32Array(18).fill(1)
    if (bad !== undefined) f[7] = bad
    return f.buffer
  }
  it('parseYear accepts a good buffer', () => expect(parseYear('Site01', yh, yearBuf()).count).toBe(3))
  it('parseYear rejects NaN and names the file', () => expect(() => parseYear('Site01', yh, yearBuf(NaN))).toThrow(/Site01\/year\.bin.*finite/))
  it('parseYear rejects Infinity', () => expect(() => parseYear('Site01', yh, yearBuf(Infinity))).toThrow(/Site01\/year\.bin.*finite/))
  it('parseYear rejects a wrong byte length', () => expect(() => parseYear('Site01', yh, new ArrayBuffer(8))).toThrow(/Site01\/year\.bin/))
  it('parseYear rejects an invalid header', () =>
    expect(() => parseYear('Site01', { ...yh, extendedSchema: 1 } as unknown as ExtendedHeader, yearBuf())).toThrow(/Site01\/extended\.json/))
  const ch = makeHeader('Site01', 3, true) as unknown as ExtendedHeader
  const cellsBuf = (bad?: number) => {
    const a = new Int16Array(2 * 360).fill(5)
    if (bad !== undefined) a[100] = bad
    return a.buffer
  }
  it('parseCells accepts a good buffer', () => expect(parseCells(ch, cellsBuf()).n).toBe(2))
  it('parseCells rejects the int16 sentinel -32768', () => expect(() => parseCells(ch, cellsBuf(-32768))).toThrow(/Site01\/cells\.bin.*-32768/))
  it('parseCells rejects a wrong byte length', () => expect(() => parseCells(ch, new ArrayBuffer(10))).toThrow(/Site01\/cells\.bin/))
  it('parseCells rejects an invalid header', () =>
    expect(() => parseCells({ ...ch, extendedSchema: 9 } as unknown as ExtendedHeader, cellsBuf())).toThrow(/Site01\/extended\.json/))
})

describe('sha256 of real binaries', () => {
  it('matches extended.json for every year.bin and cells.bin', () => {
    let checked = 0
    for (const { id } of sites.sites) {
      if (!existsSync(DATA_DIR + `${id}/extended.json`)) continue
      const h = read<ExtendedHeader>(`${id}/extended.json`)
      for (const part of [h.year, h.cells]) {
        if (!part) continue
        const digest = createHash('sha256').update(readFileSync(DATA_DIR + `${id}/${part.file}`)).digest('hex')
        expect(digest, `${id}/${part.file}`).toBe(part.sha256)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

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

  const header = makeHeader('X', 2)
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
