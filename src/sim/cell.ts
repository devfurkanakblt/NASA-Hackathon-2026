/**
 * A regional map cell as a full scenario site. The Sun / Earth series of the site centre
 * (JPL Horizons az/el/range) is rebuilt as Moon-fixed positions and re-projected into the
 * cell's own local frame — the TypeScript twin of `regional_map.body_vectors` + `local_azel`.
 * Near the pole a few km change the azimuth by degrees, and the Earth's parallax over a few
 * km is included because the range is kept.
 */
import type { BodySeries, EphemerisDoc, SiteData } from '../data/contract.ts'
import type { SeasonDoc } from '../data/contract.ts'
import { cellHorizon, type CellHorizons } from '../data/extended.ts'
import { seasonFromSeries } from './season.ts'

export const MOON_RADIUS_M = 1737400
export const CELL_LABEL = 'Regional map point (1° horizon), not a catalogue site'

const RAD = Math.PI / 180

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

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface Observer { latDeg: number; lonDeg: number; eyeM: number }

/** Body positions relative to the Moon's centre, Moon-fixed, xyz per sample (length 3 × count). */
export interface MoonFixedBodies {
  startIndex: number
  count: number
  sun: Float64Array
  earth: Float64Array
}

function moonFixed(s: BodySeries, fc: Frame, rc: number, startIndex: number, count: number): Float64Array {
  const out = new Float64Array(3 * count)
  for (let k = 0; k < count; k++) {
    const i = startIndex + k
    const az = s.azDeg[i] * RAD
    const el = s.elDeg[i] * RAD
    const r = s.distanceM[i]
    const ce = Math.cos(el)
    const ue = ce * Math.sin(az)
    const un = ce * Math.cos(az)
    const uu = Math.sin(el)
    for (let j = 0; j < 3; j++) out[3 * k + j] = r * (ue * fc.e[j] + un * fc.n[j] + uu * fc.u[j]) + rc * fc.u[j]
  }
  return out
}

/**
 * Moon-fixed Sun / Earth positions rebuilt once from the centre's az/el/range for samples
 * `[startIndex, startIndex + count)`. Cached per ephemeris object, centre observer and range, so a
 * search over thousands of cells re-projects only the mission slice and never rebuilds the
 * 52 561-sample year per cell.
 */
const bodiesCache = new WeakMap<EphemerisDoc, Map<string, MoonFixedBodies>>()

export function moonFixedBodies(eph: EphemerisDoc, centre: Observer, startIndex = 0, count = eph.count): MoonFixedBodies {
  if (!Number.isInteger(startIndex) || !Number.isInteger(count) || startIndex < 0 || count < 1 || startIndex + count > eph.count) {
    throw new RangeError(`Samples ${startIndex}..${startIndex + count - 1} outside the ${eph.count} of ${eph.siteId}.`)
  }
  const key = `${centre.latDeg},${centre.lonDeg},${centre.eyeM},${startIndex},${count}`
  let byKey = bodiesCache.get(eph)
  if (!byKey) bodiesCache.set(eph, (byKey = new Map()))
  let bodies = byKey.get(key)
  if (!bodies) {
    const fc = enu(centre.latDeg, centre.lonDeg)
    const rc = MOON_RADIUS_M + centre.eyeM
    bodies = { startIndex, count, sun: moonFixed(eph.sun, fc, rc, startIndex, count), earth: moonFixed(eph.earth, fc, rc, startIndex, count) }
    byKey.set(key, bodies)
  }
  return bodies
}

function project(p: Float64Array, cell: Observer): BodySeries {
  const fx = enu(cell.latDeg, cell.lonDeg)
  const rx = MOON_RADIUS_M + cell.eyeM
  const o: Vec = [rx * fx.u[0], rx * fx.u[1], rx * fx.u[2]]
  const n = p.length / 3
  const azDeg = new Array<number>(n)
  const elDeg = new Array<number>(n)
  const distanceM = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    // body − cell, Moon-fixed
    const v: Vec = [p[3 * k] - o[0], p[3 * k + 1] - o[1], p[3 * k + 2] - o[2]]
    const x = dot(v, fx.e)
    const y = dot(v, fx.n)
    const z = dot(v, fx.u)
    azDeg[k] = (((Math.atan2(x, y) / RAD) % 360) + 360) % 360
    elDeg[k] = Math.atan2(z, Math.hypot(x, y)) / RAD
    distanceM[k] = Math.hypot(x, y, z)
  }
  return { azDeg, elDeg, distanceM }
}

/** The ephemeris seen from `cell`, given the one seen from `centre`. */
export function cellEphemeris(eph: EphemerisDoc, centre: Observer, cell: Observer): EphemerisDoc {
  return cellEphemerisSlice(eph, centre, cell, 0, eph.count)
}

/**
 * Samples `[startIndex, startIndex + count)` of the ephemeris seen from `cell`, as an ephemeris
 * of its own (its `startUtc` is that of sample `startIndex`). Same numbers as the matching part
 * of `cellEphemeris`; used for searches, where only the mission slice is needed.
 */
export function cellEphemerisSlice(eph: EphemerisDoc, centre: Observer, cell: Observer, startIndex: number, count: number): EphemerisDoc {
  const bodies = moonFixedBodies(eph, centre, startIndex, count)
  const startUtc = startIndex === 0 ? eph.startUtc : new Date(Date.parse(eph.startUtc) + startIndex * eph.stepS * 1000).toISOString().replace('.000Z', 'Z')
  return { ...eph, startUtc, count, sun: project(bodies.sun, cell), earth: project(bodies.earth, cell) }
}

/** Observer at the catalogue site centre (eye height above the 1737.4 km sphere). */
export const centreObserver = (s: SiteData['site']): Observer => ({ latDeg: s.latDeg, lonDeg: s.lonDeg, eyeM: s.surfaceElevationM + s.observerHeightM })

/** Season tables per year series and cell id: a cell's summary is computed once. */
const seasonCache = new WeakMap<EphemerisDoc, WeakMap<CellHorizons, Map<string, SeasonDoc>>>()

function cachedSeason(year: EphemerisDoc, cells: CellHorizons, id: string, make: () => SeasonDoc): SeasonDoc {
  let byCells = seasonCache.get(year)
  if (!byCells) seasonCache.set(year, (byCells = new WeakMap()))
  let byId = byCells.get(cells)
  if (!byId) byCells.set(cells, (byId = new Map()))
  let doc = byId.get(id)
  if (!doc) byId.set(id, (doc = make()))
  return doc
}

/**
 * Cell (row, col) of the site's regional map as a site: own horizon, own ephemeris, labelled,
 * and its own monthly / yearly summary (`season`) from that ephemeris and 1° horizon — never
 * the catalogue centre's `season.json`.
 */
export function cellSiteData(base: SiteData, year: EphemerisDoc, cells: CellHorizons, row: number, col: number): SiteData {
  const map = base.map
  if (!map) throw new RangeError(`${base.site.id} has no regional map.`)
  const { nx, ny } = map.grid
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= ny || col >= nx) {
    throw new RangeError(`Cell ${row},${col} is outside the ${nx}×${ny} map of ${base.site.id}.`)
  }
  if (cells.n !== nx * ny) throw new RangeError(`${base.site.id}: cells.bin has ${cells.n} cells, map.json ${nx * ny}.`)
  const index = row * nx + col
  const s = base.site
  const { spacingM, halfSizeM } = map.grid
  const east = -halfSizeM + col * spacingM
  const north = -halfSizeM + row * spacingM
  const m = (v: number) => `${Math.abs(Math.round(v))} m`
  const where = east === 0 && north === 0 ? 'site centre' : `${m(east)} ${east >= 0 ? 'east' : 'west'}, ${m(north)} ${north >= 0 ? 'north' : 'south'} of the site centre`
  const cell: Observer = { latDeg: map.latDeg[index], lonDeg: map.lonDeg[index], eyeM: cells.eyeM[index] }
  const id = `${s.id}:r${row}c${col}`
  const horizon = cellHorizon(cells, index)
  const ephemeris = cellEphemeris(year, centreObserver(s), cell)
  const season = cachedSeason(year, cells, id, () => ({ ...seasonFromSeries({ ...ephemeris, siteId: id }, horizon), siteId: id }))
  return {
    ...base,
    site: {
      ...s,
      id,
      name: `${s.name} — map point`,
      latDeg: cell.latDeg,
      lonDeg: cell.lonDeg,
      surfaceElevationM: map.surfaceElevationM[index] ?? cell.eyeM - s.observerHeightM,
      label: CELL_LABEL,
      coordSource: `Regional map of ${s.id} (map.json cell centre)`,
      derivedFrom: s.id,
      derivation: `regional map cell row ${row}, col ${col} (${where}); 1° terrain horizon`,
      warnings: [],
    },
    horizon,
    ephemeris,
    terrain: base.terrain,
    season,
    map,
  }
}
