/**
 * Any coordinate on the Moon, computed in the browser (D):
 *
 * - Sun / Earth: the Moon-fixed Sun and Earth positions of a loaded one-year series (JPL Horizons,
 *   any site) re-projected into the point's own local frame (`moonFixed.ts`, exact geometry with
 *   parallax). Validated against catalogue sites that have their own Horizons series.
 * - Terrain horizon: the same rule as `preprocess/horizon.py` (great circles, exact curvature,
 *   `elev = atan2(Rt cosθ − Ro, Rt sinθ)`), 0.1° azimuth step, out to 250 km, eye 2 m above the DEM.
 *
 * On the south-polar cap the 80 m regional DEM (the catalogue's own `regional80` product) is used:
 * 80 m within 25 km, its 640 m mean out to 250 km, plus a 10 km 3D display patch; labelled
 * "regional screening estimate". Elsewhere the global DEM is coarse (~1.9 km/px), so near-field hills
 * and crater walls smaller than a few km are missing: "global screening estimate". Neither is
 * catalogue precision or a substitute for `python -m preprocess.custom_point`.
 */
import type { EphemerisDoc, HorizonDoc, SiteData, SiteEntry, TerrainDoc } from '../data/contract.ts'
import type { GlobalDem } from '../data/globalDem.ts'
import { polarXY, type PolarDem } from '../data/polarDem.ts'

import { MOON_RADIUS_M, moonFixedKey, moonFixedSeries, projectWindow, type Observer } from './moonFixed.ts'
import { seasonFromSeries } from './season.ts'

export const OBSERVER_HEIGHT_M = 2
export const FREE_RANGE_M = 250000
export const FREE_AZ_STEP_DEG = 0.1

export const FREE_POINT_LABEL = 'Global screening estimate (coarse global terrain), not a catalogue site'
export const FREE_POINT_POLAR_LABEL = 'Regional screening estimate (80 m south-polar terrain), not a catalogue site'

const ID = /^pt:(-?\d{1,2}(?:\.\d+)?):(-?\d{1,3}(?:\.\d+)?)$/

/** Longitude in (−180, 180]. */
const normLon = (lon: number) => {
  const x = ((lon % 360) + 360) % 360
  return x > 180 ? x - 360 : x
}

/** Scenario id of a free point, 5 decimals (~0.3 m): `pt:-12.34567:45.67890`. */
export function freePointId(latDeg: number, lonDeg: number): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || latDeg < -90 || latDeg > 90) throw new RangeError('Latitude must be between −90° and 90°, longitude a number.')
  const lon = normLon(lonDeg)
  const f = (v: number) => (Object.is(Math.round(v * 1e5), -0) ? 0 : v).toFixed(5)
  return `pt:${f(latDeg)}:${f(lon === -180 ? 180 : lon)}`
}

export function parseFreePointId(id: string): { latDeg: number; lonDeg: number } | null {
  const m = ID.exec(id)
  if (!m) return null
  const latDeg = Number(m[1])
  const lonDeg = Number(m[2])
  if (!(latDeg >= -90 && latDeg <= 90) || !(lonDeg > -180 && lonDeg <= 180)) return null
  return { latDeg, lonDeg }
}

/** Distances along each ray: half a DEM pixel apart near the observer, growing to 2 px far out. */
export function rayDistances(pixelM: number, rangeM = FREE_RANGE_M): Float64Array {
  const out: number[] = []
  let d = pixelM / 2
  while (d <= rangeM) {
    out.push(d)
    d += Math.min(2 * pixelM, Math.max(pixelM / 2, d * 0.02))
  }
  return Float64Array.from(out)
}

/** Height (m above the sphere) at a lat / lon, `dM` metres along the ray (lets a sampler pick near / far data). */
export type HeightSampler = (latDeg: number, lonDeg: number, dM: number) => number

/** The `preprocess/horizon.py` rule on any height sampler: great circles, exact curvature, max elevation per azimuth. */
export function rayHorizon(sample: HeightSampler, distances: Float64Array, latDeg: number, lonDeg: number, eyeM: number, azStepDeg = FREE_AZ_STEP_DEG): { elevDeg: number[]; distanceM: number[] } {
  const R = MOON_RADIUS_M
  const n = Math.round(360 / azStepDeg)
  const d = distances
  const th = d.map((x) => x / R)
  const cosT = th.map(Math.cos)
  const sinT = th.map(Math.sin)
  const phi = (latDeg * Math.PI) / 180
  const lam = (lonDeg * Math.PI) / 180
  const p = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)]
  const north = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)]
  const east = [-Math.sin(lam), Math.cos(lam), 0]
  const Ro = R + eyeM
  const elevDeg = new Array<number>(n)
  const distanceM = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = (i * azStepDeg * Math.PI) / 180
    const u = [Math.cos(a) * north[0] + Math.sin(a) * east[0], Math.cos(a) * north[1] + Math.sin(a) * east[1], Math.cos(a) * north[2] + Math.sin(a) * east[2]]
    let best = -Infinity
    let bestD = d[0]
    for (let k = 0; k < d.length; k++) {
      const qx = p[0] * cosT[k] + u[0] * sinT[k]
      const qy = p[1] * cosT[k] + u[1] * sinT[k]
      const qz = p[2] * cosT[k] + u[2] * sinT[k]
      const lat = (Math.asin(Math.max(-1, Math.min(1, qz))) * 180) / Math.PI
      const lon = (Math.atan2(qy, qx) * 180) / Math.PI
      const Rt = R + sample(lat, lon, d[k])
      const e = Math.atan2(Rt * cosT[k] - Ro, Rt * sinT[k])
      if (e > best) {
        best = e
        bestD = d[k]
      }
    }
    elevDeg[i] = (best * 180) / Math.PI
    distanceM[i] = bestD
  }
  return { elevDeg, distanceM }
}

/** 0.1° terrain horizon of (lat, lon) on the global tiles, for an eye `eyeM` above the reference sphere. */
export function globalHorizon(dem: GlobalDem, latDeg: number, lonDeg: number, eyeM: number, azStepDeg = FREE_AZ_STEP_DEG, rangeM = FREE_RANGE_M): HorizonDoc {
  const r = rayHorizon((lat, lon) => dem.heightAt(lat, lon), rayDistances(dem.manifest.pixelM, rangeM), latDeg, lonDeg, eyeM, azStepDeg)
  return {
    azStepDeg,
    count: r.elevDeg.length,
    ...r,
    warnings: [`Horizon ray-marched on ${dem.manifest.method} (~${(dem.manifest.pixelM / 1000).toFixed(1)} km/px) out to ${rangeM / 1000} km: hills and crater walls smaller than a few km are not resolved.`],
  }
}

/** 80 m near field, as far as this distance along each ray (the rest uses the 640 m grid). */
export const POLAR_NEAR_RANGE_M = 25000

/** Ray samples for the polar DEM: half an 80 m pixel up to the near range, half a 640 m pixel beyond. */
export function polarDistances(nearResM: number, farResM: number, nearRangeM = POLAR_NEAR_RANGE_M, rangeM = FREE_RANGE_M): Float64Array {
  const out: number[] = []
  for (let d = nearResM / 2; d <= nearRangeM; d += nearResM / 2) out.push(d)
  for (let d = nearRangeM + farResM / 2; d <= rangeM; d += farResM / 2) out.push(d)
  return Float64Array.from(out)
}

/**
 * 0.1° horizon on the south-polar DEM: 80 m within the near range, its 640 m mean beyond; where a ray
 * leaves the polar grid it continues on the global tiles (counted and reported, never zero terrain).
 */
export function polarHorizon(polar: PolarDem, global: GlobalDem, latDeg: number, lonDeg: number, eyeM: number, azStepDeg = FREE_AZ_STEP_DEG, rangeM = FREE_RANGE_M): HorizonDoc {
  const m = polar.manifest
  let fallback = 0
  let total = 0
  const sample: HeightSampler = (lat, lon, dM) => {
    total++
    const [x, y] = polarXY(m, lat, lon)
    let h = dM <= POLAR_NEAR_RANGE_M ? polar.nearAt(x, y) : Number.NaN
    if (Number.isNaN(h)) h = polar.farAt(x, y)
    if (Number.isNaN(h)) {
      fallback++
      h = global.heightAt(lat, lon)
    }
    return h
  }
  const r = rayHorizon(sample, polarDistances(m.near.resM, m.far.resM, POLAR_NEAR_RANGE_M, rangeM), latDeg, lonDeg, eyeM, azStepDeg)
  const warnings = [`Horizon ray-marched on the 80 m south-polar LOLA DEM within ${POLAR_NEAR_RANGE_M / 1000} km and its 640 m mean out to ${rangeM / 1000} km: features smaller than about 100 m are not resolved.`]
  if (fallback > 0) warnings.push(`${((100 * fallback) / total).toFixed(1)} % of the ray samples lie beyond the south-polar DEM and use the ~1.9 km global terrain.`)
  return { azStepDeg, count: r.elevDeg.length, ...r, warnings }
}

/** 3D display patch (terrain.json shape): `sizeM` square, `n` cells, heights relative to the eye, curvature included. */
export function localTerrainGrid(heightAt: (latDeg: number, lonDeg: number) => number, latDeg: number, lonDeg: number, observerHeightM: number, sizeM: number, n: number): TerrainDoc {
  const R = MOON_RADIUS_M
  const cellM = sizeM / n
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  const east = [-Math.sin(lon), Math.cos(lon), 0]
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)]
  const centreM = heightAt(latDeg, lonDeg)
  const zM: number[] = []
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const e = (col + 0.5) * cellM - sizeM / 2
      const no = (row + 0.5) * cellM - sizeM / 2
      const rho = Math.hypot(e, no)
      let h = centreM
      let theta = 0
      for (let k = 0; k < 4; k++) {
        theta = Math.asin(rho / (R + h))
        const q = up.map((v, i) => v * Math.cos(theta) + (rho ? ((e * east[i] + no * north[i]) / rho) * Math.sin(theta) : 0))
        h = heightAt((Math.asin(Math.max(-1, Math.min(1, q[2]))) * 180) / Math.PI, (Math.atan2(q[1], q[0]) * 180) / Math.PI)
      }
      theta = Math.asin(rho / (R + h))
      zM.push((R + h) * Math.cos(theta) - R - centreM - observerHeightM)
    }
  }
  return { n, sizeM, cellM, zM }
}

export interface FreePointInput {
  /** Screening searches can project only the requested mission window. */
  window?: { startIndex: number; count: number }
  azStepDeg?: number
  skipSeason?: boolean
  latDeg: number
  lonDeg: number
  dem: GlobalDem
  /** South-polar 80 m DEM; used when the point lies on it. */
  polar?: PolarDem | null
  /** A loaded one-year series and the site it was computed for (any site). */
  year: EphemerisDoc
  yearSite: SiteEntry
  /** `year.sha256` of that series (cache key of the Moon-fixed vectors). */
  yearSha256: string
}

/** The engine input for a free point: own horizon, own ephemeris, own season table, labelled. */
export function freePointSiteData(input: FreePointInput): SiteData {
  const { dem, year, yearSite } = input
  const id = freePointId(input.latDeg, input.lonDeg)
  const { latDeg, lonDeg } = parseFreePointId(id)!
  const polar = input.polar && input.polar.covers(latDeg, lonDeg) ? input.polar : null
  const polarHeight = polar
    ? (lat: number, lon: number) => {
        const [x, y] = polarXY(polar.manifest, lat, lon)
        const h = polar.nearAt(x, y)
        return Number.isNaN(h) ? dem.heightAt(lat, lon) : h
      }
    : null
  const surface = polarHeight ? polarHeight(latDeg, lonDeg) : dem.heightAt(latDeg, lonDeg)
  const eyeM = surface + OBSERVER_HEIGHT_M
  const point: Observer = { latDeg, lonDeg, eyeM }
  const centre: Observer = { latDeg: yearSite.latDeg, lonDeg: yearSite.lonDeg, eyeM: yearSite.surfaceElevationM + yearSite.observerHeightM }
  const mf = moonFixedSeries(year, centre, moonFixedKey({ dataHash: input.yearSha256, ...centre, horizonResolutionDeg: 0.1 }))
  const ephemeris = { ...projectWindow(mf, point, input.window?.startIndex ?? 0, input.window ? input.window.startIndex + input.window.count : mf.count), siteId: id }
  const horizon = polar ? polarHorizon(polar, dem, latDeg, lonDeg, eyeM, input.azStepDeg) : globalHorizon(dem, latDeg, lonDeg, eyeM, input.azStepDeg)
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`
  const warnings = [
    ...horizon.warnings!,
    'Computed in the browser for this exact coordinate; for catalogue-quality terrain generate a package with python -m preprocess.custom_point.',
  ]
  const demFar = polar ? `${polar.manifest.source}; 640 m mean beyond ${POLAR_NEAR_RANGE_M / 1000} km` : `${dem.manifest.source}; ${dem.manifest.method}`
  const site: SiteEntry = {
    id,
    name: `Your point ${fmt(latDeg, 'N', 'S')}, ${fmt(lonDeg, 'E', 'W')}`,
    latDeg,
    lonDeg,
    surfaceElevationM: Math.round(surface * 100) / 100,
    observerHeightM: OBSERVER_HEIGHT_M,
    label: polar ? FREE_POINT_POLAR_LABEL : FREE_POINT_LABEL,
    coordSource: 'Entered by the user',
    demNear: polar ? polar.manifest.source : demFar,
    demFar,
    warnings,
    category: 'free',
  }
  const data: SiteData = {
    site,
    ephemeris,
    horizon,
    // 10 km at ~78 m cells from the 80 m DEM; none from the coarse global tiles (the scene draws its own).
    terrain: polarHeight ? localTerrainGrid(polarHeight, latDeg, lonDeg, OBSERVER_HEIGHT_M, 10000, 128) : undefined,
    provenance: {
      latDeg,
      lonDeg,
      observerHeightM: OBSERVER_HEIGHT_M,
      eyeM,
      horizonResolutionDeg: input.azStepDeg ?? FREE_AZ_STEP_DEG,
      horizonSource: polar ? 'regional-dem' : 'global-dem',
      ephemerisSource: `${year.source} (Moon-fixed vectors of ${yearSite.id} re-projected to this point)`,
      dataHash: input.yearSha256,
      precision: polar ? 'regional screening estimate' : 'global screening estimate',
      coverageWarnings: warnings,
    },
  }
  // Screening searches skip the season table; a scenario gets the point's own one.
  return input.skipSeason ? data : { ...data, season: { ...seasonFromSeries(ephemeris, horizon), siteId: id } }
}
