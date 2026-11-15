/// <reference types="node" />
/**
 * `extended.json` / `year.bin` / `cells.bin` contract checks (A/D task): the parsers must refuse
 * a wrong version / site / UTC / step / count, a partial azimuth ring, a bad angle unit, and
 * NaN or out-of-range values — synthetic fixtures that used to be accepted.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SitesDoc } from '../src/data/contract.ts'
import { parseCells, parseYear, validateExtendedHeader, type ExtendedHeader } from '../src/data/extended.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

const SHA = '0'.repeat(64)
const good = (): ExtendedHeader => ({
  version: 1,
  extendedSchema: 2,
  siteId: 'X',
  year: {
    file: 'year.bin', sha256: SHA, startUtc: '2026-11-01T00:00:00Z', endUtc: '2026-11-01T00:10:00Z', stepS: 600, count: 2,
    source: 'jpl-horizons', observer: { latDeg: -89.5, lonDeg: 0, eyeM: 10 },
    fields: ['sun.azDeg', 'sun.elDeg', 'sun.distanceM', 'earth.azDeg', 'earth.elDeg', 'earth.distanceM'],
  },
  cells: {
    file: 'cells.bin', sha256: SHA, azStartDeg: 0, azStepDeg: 90, count: 4, coverageDeg: 360, unitDeg: 0.01,
    horizonResolutionDeg: 90, n: 2, eyeM: [10, 11], grid: { nx: 2, ny: 1, spacingM: 500, halfSizeM: 250 },
  },
})
// sun az, el, dist, earth az, el, dist — 2 samples each
const yearValues = () => new Float32Array([10, 20, 1, 2, 1.5e11, 1.5e11, 30, 40, 3, 4, 3.8e8, 3.8e8])
const cellValues = () => new Int16Array([0, 100, 200, 300, -50, 0, 50, 0])

describe('validateExtendedHeader', () => {
  it('accepts every real header', () => {
    for (const { id } of read<SitesDoc>('sites.json').sites) {
      expect(validateExtendedHeader(read<ExtendedHeader>(`${id}/extended.json`), id), id).toEqual([])
    }
    expect(validateExtendedHeader(good(), 'X')).toEqual([])
  })

  const cases: [string, (h: ExtendedHeader) => void, RegExp][] = [
    ['unknown version', (h) => { h.version = 2 }, /version must be 1/],
    ['other site', (h) => { h.siteId = 'Y' }, /siteId must be "X", got "Y"/],
    ['no source', (h) => { h.year.source = '' }, /year.source/],
    ['local time', (h) => { h.year.startUtc = '2026-11-01T00:00:00' }, /startUtc/],
    ['not a date', (h) => { h.year.startUtc = '2026-13-45T00:00:00Z' }, /startUtc/],
    ['zero step', (h) => { h.year.stepS = 0 }, /stepS/],
    ['fractional step', (h) => { h.year.stepS = 600.5 }, /stepS/],
    ['one sample', (h) => { h.year.count = 1 }, /count/],
    ['half ring', (h) => { h.cells!.azStepDeg = 45 }, /must equal 360/],
    ['NaN step', (h) => { h.cells!.azStepDeg = Number.NaN }, /must equal 360/],
    ['zero unit', (h) => { h.cells!.unitDeg = 0 }, /unitDeg/],
    ['eye heights short', (h) => { h.cells!.eyeM = [10] }, /eyeM/],
    ['NaN eye height', (h) => { h.cells!.eyeM = [10, Number.NaN] }, /eyeM contains a non-finite/],
  ]
  for (const [name, mutate, message] of cases) {
    it(`refuses: ${name}`, () => {
      const h = good()
      mutate(h)
      expect(validateExtendedHeader(h, 'X').join(' ')).toMatch(message)
      expect(() => parseYear('X', h, yearValues().buffer)).toThrow(message)
    })
  }
})

describe('parseYear values', () => {
  it('accepts a good fixture', () => {
    const y = parseYear('X', good(), yearValues().buffer)
    expect(y.sun.elDeg).toEqual([1, 2])
  })
  const bad: [string, number, number, RegExp][] = [
    ['NaN sun elevation', 2, Number.NaN, /sun elDeg\[0\] = NaN/],
    ['Infinity earth distance', 11, Number.POSITIVE_INFINITY, /earth distanceM\[1\]/],
    ['negative azimuth', 0, -1, /sun azDeg\[0\] = -1/],
    ['elevation above 90°', 9, 91, /earth elDeg\[1\]/],
    ['zero distance', 4, 0, /sun distanceM\[0\]/],
  ]
  for (const [name, index, value, message] of bad) {
    it(`refuses ${name}`, () => {
      const f = yearValues()
      f[index] = value
      expect(() => parseYear('X', good(), f.buffer)).toThrow(message)
    })
  }
  it('real year.bin files pass', () => {
    for (const id of ['Site01', 'CE6']) expect(parseYear(id, read(`${id}/extended.json`), readBin(`${id}/year.bin`)).count).toBe(52561)
  })
})

describe('parseCells values', () => {
  it('accepts a good fixture and keeps the order', () => {
    const c = parseCells(good(), cellValues().buffer)
    expect(Array.from(c.data)).toEqual([0, 100, 200, 300, -50, 0, 50, 0])
  })
  it('refuses a horizon beyond ±90°', () => {
    const v = cellValues()
    v[5] = 9001
    expect(() => parseCells(good(), v.buffer)).toThrow(/cell 1 azimuth 90° has horizon 90.01°/)
  })
  it('refuses a header problem before reading cells', () => {
    const h = good()
    h.cells!.unitDeg = -0.01
    expect(() => parseCells(h, cellValues().buffer)).toThrow(/unitDeg/)
  })
  it('refuses a wrong byte length', () => {
    expect(() => parseCells(good(), new Int16Array(7).buffer)).toThrow(/expected 16 bytes/)
  })
})
