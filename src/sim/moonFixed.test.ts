/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EphemerisDoc, MapDoc } from '../data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader } from '../data/extended.ts'
import { cellEphemeris } from './cell.ts'
import { CoverageError } from './evaluate.ts'
import { moonFixedKey, moonFixedSeries, projectWindow, type Observer } from './moonFixed.ts'

const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

const header = read<ExtendedHeader>('Site01/extended.json')
const year = parseYear('Site01', header, readBin('Site01/year.bin'))
const cells = parseCells(header, readBin('Site01/cells.bin'))
const map = read<MapDoc>('Site01/map.json')
const centre: Observer = header.year.observer!
const I = 36 * 61 + 32
const cell: Observer = { latDeg: map.latDeg[I], lonDeg: map.lonDeg[I], eyeM: cells.eyeM[I] }
const keyOf = (o: Observer, dataHash = header.year.sha256) => moonFixedKey({ dataHash, ...o, horizonResolutionDeg: header.cells!.horizonResolutionDeg })

describe('moonFixed', () => {
  it('projectWindow equals the matching slice of cellEphemeris to 1e-9°', () => {
    const full = cellEphemeris(year, centre, cell)
    const win = projectWindow(moonFixedSeries(year, centre, keyOf(centre)), cell, 1000, 2008)
    expect(win.count).toBe(1008)
    expect(win.sun.azDeg).toHaveLength(1008)
    expect(Date.parse(win.startUtc)).toBe(Date.parse(year.startUtc) + 1000 * year.stepS * 1000)
    for (const b of ['sun', 'earth'] as const) {
      for (let k = 0; k < 1008; k++) {
        expect(Math.abs(wrap(win[b].azDeg[k] - full[b].azDeg[1000 + k]))).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(win[b].elDeg[k] - full[b].elDeg[1000 + k])).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(win[b].distanceM[k] - full[b].distanceM[1000 + k])).toBeLessThanOrEqual(1e-3)
      }
    }
  })

  it('same key returns the same cached object, different eyeM gives a different key', () => {
    const k = keyOf(centre)
    expect(moonFixedSeries(year, centre, k)).toBe(moonFixedSeries(year, centre, k))
    expect(keyOf({ ...centre, eyeM: centre.eyeM + 1 })).not.toBe(k)
    expect(keyOf({ ...centre, eyeM: centre.eyeM + 0.001 })).toBe(k)
  })

  it('different dataHash never reuses the cache', () => {
    const a = moonFixedSeries(year, centre, keyOf(centre, 'a'.repeat(64)))
    const b = moonFixedSeries(year, centre, keyOf(centre, 'b'.repeat(64)))
    expect(a).not.toBe(b)
    expect(a.key).not.toBe(b.key)
  })

  it('window past count throws CoverageError', () => {
    const mf = moonFixedSeries(year, centre, keyOf(centre))
    expect(() => projectWindow(mf, cell, mf.count - 10, mf.count + 1)).toThrow(CoverageError)
    expect(() => projectWindow(mf, cell, -1, 5)).toThrow(CoverageError)
    expect(projectWindow(mf, cell, mf.count - 10, mf.count).count).toBe(10)
  })

  it('azimuth wraps 359.9° → 0.1° without a jump', () => {
    const body = { azDeg: [359.9, 0.1], elDeg: [10, 10], distanceM: [1.5e11, 1.5e11] }
    const eph: EphemerisDoc = { siteId: 'x', source: 'test', startUtc: '2027-01-01T00:00:00Z', stepS: 600, count: 2, sun: body, earth: body }
    const out = projectWindow(moonFixedSeries(eph, centre, 'wrap-test'), centre, 0, 2)
    expect(out.sun.azDeg[0]).toBeCloseTo(359.9, 6)
    expect(out.sun.azDeg[1]).toBeCloseTo(0.1, 6)
    expect(Math.abs(wrap(out.sun.azDeg[1] - out.sun.azDeg[0]))).toBeCloseTo(0.2, 6)
  })
})
