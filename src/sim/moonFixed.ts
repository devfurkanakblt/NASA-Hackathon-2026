/**
 * Moon-fixed body vectors for the Sun and the Earth, built once per (data package, centre observer)
 * and re-projected into any cell's local frame for a window of samples. The TypeScript twin of
 * `regional_map.body_vectors` + `local_azel`. `map.json` percentages are not used in this flow.
 */
import type { BodySeries, EphemerisDoc } from '../data/contract.ts'
import { CoverageError } from './evaluate.ts'

export const MOON_RADIUS_M = 1737400

const RAD = Math.PI / 180

export interface Observer { latDeg: number; lonDeg: number; eyeM: number }

export type EphemerisMeta = Omit<EphemerisDoc, 'sun' | 'earth' | 'startUtc' | 'stepS' | 'count'>

/** `sun` and `earth` hold 3·count Moon-fixed metres (x, y, z per sample). */
export interface MoonFixedSeries {
  key: string
  startUtc: string
  stepS: number
  count: number
  sun: Float64Array
  earth: Float64Array
  /** Non-series fields of the source ephemeris (siteId, source, ...), carried into projected windows. */
  meta: EphemerisMeta
}

type Vec = [number, number, number]
interface Frame { e: Vec; n: Vec; u: Vec }

function enu(latDeg: number, lonDeg: number): Frame {
  const p = latDeg * RAD
  const l = lonDeg * RAD
  return {
    u: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
    n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    e: [-Math.sin(l), Math.cos(l), 0],
  }
}

/** The cache key: data package hash, centre/cell coordinate (1e-7° rounded), eye (0.01 m rounded) and horizon resolution. */
export function moonFixedKey(p: { dataHash: string; latDeg: number; lonDeg: number; eyeM: number; horizonResolutionDeg: number }): string {
  const lat = Math.round(p.latDeg * 1e7) / 1e7
  const lon = Math.round(p.lonDeg * 1e7) / 1e7
  const eye = Math.round(p.eyeM * 100) / 100
  return `${p.dataHash}|${lat}|${lon}|${eye}|${p.horizonResolutionDeg}`
}

function build(s: BodySeries, fc: Frame, pc: Vec): Float64Array {
  const n = s.azDeg.length
  const out = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) {
    const az = s.azDeg[i] * RAD
    const el = s.elDeg[i] * RAD
    const r = s.distanceM[i]
    const ce = Math.cos(el)
    const ue = ce * Math.sin(az)
    const un = ce * Math.cos(az)
    const uu = Math.sin(el)
    // body position, Moon-fixed: centre position + r·u
    out[3 * i] = pc[0] + r * (ue * fc.e[0] + un * fc.n[0] + uu * fc.u[0])
    out[3 * i + 1] = pc[1] + r * (ue * fc.e[1] + un * fc.n[1] + uu * fc.u[1])
    out[3 * i + 2] = pc[2] + r * (ue * fc.e[2] + un * fc.n[2] + uu * fc.u[2])
  }
  return out
}

function buildSeries(year: EphemerisDoc, centre: Observer, key: string): MoonFixedSeries {
  const fc = enu(centre.latDeg, centre.lonDeg)
  const rc = MOON_RADIUS_M + centre.eyeM
  const pc: Vec = [rc * fc.u[0], rc * fc.u[1], rc * fc.u[2]]
  const { sun, earth, startUtc, stepS, count, ...meta } = year
  return { key, startUtc, stepS, count, sun: build(sun, fc, pc), earth: build(earth, fc, pc), meta }
}

const CACHE_LIMIT = 8
const cache = new Map<string, MoonFixedSeries>()

/** Moon-fixed Sun / Earth vectors of `year` seen from `centre`, cached by `key` (see `moonFixedKey`). */
export function moonFixedSeries(year: EphemerisDoc, centre: Observer, key: string): MoonFixedSeries {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const mf = buildSeries(year, centre, key)
  cache.set(key, mf)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  return mf
}

/** Moon-fixed series without caching (used by `cellEphemeris`, which has no data hash). */
export function uncachedMoonFixedSeries(year: EphemerisDoc, centre: Observer): MoonFixedSeries {
  return buildSeries(year, centre, '')
}

function project(mf: Float64Array, fx: Frame, pcell: Vec, i0: number, i1: number): BodySeries {
  const n = i1 - i0
  const azDeg = new Array<number>(n)
  const elDeg = new Array<number>(n)
  const distanceM = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    const j = 3 * (i0 + k)
    const vx = mf[j] - pcell[0]
    const vy = mf[j + 1] - pcell[1]
    const vz = mf[j + 2] - pcell[2]
    const x = vx * fx.e[0] + vy * fx.e[1] + vz * fx.e[2]
    const y = vx * fx.n[0] + vy * fx.n[1] + vz * fx.n[2]
    const z = vx * fx.u[0] + vy * fx.u[1] + vz * fx.u[2]
    azDeg[k] = (((Math.atan2(x, y) / RAD) % 360) + 360) % 360
    elDeg[k] = Math.atan2(z, Math.hypot(x, y)) / RAD
    distanceM[k] = Math.hypot(x, y, z)
  }
  return { azDeg, elDeg, distanceM }
}

/** The ephemeris seen from `cell` for samples [i0, i1) of the series. Throws CoverageError outside [0, count]. */
export function projectWindow(mf: MoonFixedSeries, cell: Observer, i0: number, i1: number): EphemerisDoc {
  if (!Number.isInteger(i0) || !Number.isInteger(i1) || i0 < 0 || i1 > mf.count || i1 < i0) {
    throw new CoverageError(`Window [${i0}, ${i1}) is outside the ${mf.count} samples of the Moon-fixed series.`)
  }
  const fx = enu(cell.latDeg, cell.lonDeg)
  const rx = MOON_RADIUS_M + cell.eyeM
  const pcell: Vec = [rx * fx.u[0], rx * fx.u[1], rx * fx.u[2]]
  const startUtc = i0 === 0 ? mf.startUtc : new Date(Date.parse(mf.startUtc) + i0 * mf.stepS * 1000).toISOString().replace('.000Z', 'Z')
  return {
    ...mf.meta,
    startUtc,
    stepS: mf.stepS,
    count: i1 - i0,
    sun: project(mf.sun, fx, pcell, i0, i1),
    earth: project(mf.earth, fx, pcell, i0, i1),
  }
}
