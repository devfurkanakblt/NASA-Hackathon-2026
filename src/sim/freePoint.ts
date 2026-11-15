/**
 * Any coordinate on the Moon, computed in the browser (D):
 *
 * - Sun / Earth: the Moon-fixed Sun and Earth positions of a loaded one-year series (JPL Horizons,
 *   any site) re-projected into the point's own local frame (`moonFixed.ts`, exact geometry with
 *   parallax). Validated against catalogue sites that have their own Horizons series.
 * - Terrain horizon: ray-marched on the global LDEM_64 tiles with the same rule as
 *   `preprocess/horizon.py` (great circles, exact curvature, `elev = atan2(Rt cosθ − Ro, Rt sinθ)`),
 *   0.1° azimuth step, out to 250 km, eye 2 m above the DEM surface.
 *
 * The DEM is coarse (~1.9 km/px by default), so near-field hills and crater walls smaller than a
 * few km are missing: results are labelled "global screening estimate", never catalogue precision,
 * and are no substitute for `python -m preprocess.custom_point`.
 */
import type { EphemerisDoc, HorizonDoc, SiteData, SiteEntry } from '../data/contract.ts'
import type { GlobalDem } from '../data/globalDem.ts'
import { MOON_RADIUS_M, moonFixedKey, moonFixedSeries, projectWindow, type Observer } from './moonFixed.ts'
import { seasonFromSeries } from './season.ts'

export const OBSERVER_HEIGHT_M = 2
export const FREE_RANGE_M = 250000
export const FREE_AZ_STEP_DEG = 0.1

export const FREE_POINT_LABEL = 'Global screening estimate (coarse global terrain), not a catalogue site'

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

/** 0.1° terrain horizon of (lat, lon) for an eye `eyeM` above the reference sphere. */
export function globalHorizon(dem: GlobalDem, latDeg: number, lonDeg: number, eyeM: number, azStepDeg = FREE_AZ_STEP_DEG, rangeM = FREE_RANGE_M): HorizonDoc {
  const R = MOON_RADIUS_M
  const n = Math.round(360 / azStepDeg)
  const d = rayDistances(dem.manifest.pixelM, rangeM)
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
      const Rt = R + dem.heightAt(lat, lon)
      const e = Math.atan2(Rt * cosT[k] - Ro, Rt * sinT[k])
      if (e > best) {
        best = e
        bestD = d[k]
      }
    }
    elevDeg[i] = (best * 180) / Math.PI
    distanceM[i] = bestD
  }
  return {
    azStepDeg,
    count: n,
    elevDeg,
    distanceM,
    warnings: [`Horizon ray-marched on ${dem.manifest.method} (~${(dem.manifest.pixelM / 1000).toFixed(1)} km/px) out to ${rangeM / 1000} km: hills and crater walls smaller than a few km are not resolved.`],
  }
}

export interface FreePointInput {
  /** Screening searches can project only the requested mission window. */
  window?: { startIndex: number; count: number }
  azStepDeg?: number
  skipSeason?: boolean
  latDeg: number
  lonDeg: number
  dem: GlobalDem
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
  const surface = dem.heightAt(latDeg, lonDeg)
  const eyeM = surface + OBSERVER_HEIGHT_M
  const point: Observer = { latDeg, lonDeg, eyeM }
  const centre: Observer = { latDeg: yearSite.latDeg, lonDeg: yearSite.lonDeg, eyeM: yearSite.surfaceElevationM + yearSite.observerHeightM }
  const mf = moonFixedSeries(year, centre, moonFixedKey({ dataHash: input.yearSha256, ...centre, horizonResolutionDeg: 0.1 }))
  const ephemeris = { ...projectWindow(mf, point, input.window?.startIndex ?? 0, input.window ? input.window.startIndex + input.window.count : mf.count), siteId: id }
  const horizon = globalHorizon(dem, latDeg, lonDeg, eyeM, input.azStepDeg)
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`
  const warnings = [
    ...horizon.warnings!,
    'Computed in the browser for this exact coordinate; for catalogue-quality terrain generate a package with python -m preprocess.custom_point.',
  ]
  const site: SiteEntry = {
    id,
    name: `Your point ${fmt(latDeg, 'N', 'S')}, ${fmt(lonDeg, 'E', 'W')}`,
    latDeg,
    lonDeg,
    surfaceElevationM: Math.round(surface * 100) / 100,
    observerHeightM: OBSERVER_HEIGHT_M,
    label: FREE_POINT_LABEL,
    coordSource: 'Entered by the user',
    demNear: `${dem.manifest.source}; ${dem.manifest.method}`,
    demFar: `${dem.manifest.source}; ${dem.manifest.method}`,
    warnings,
    category: 'free',
  } as SiteEntry
  const data: SiteData = {
    site,
    ephemeris,
    horizon,
    provenance: {
      latDeg, lonDeg, observerHeightM: OBSERVER_HEIGHT_M, eyeM, horizonResolutionDeg: input.azStepDeg ?? FREE_AZ_STEP_DEG, horizonSource: 'global-dem',
      ephemerisSource: `${year.source} (Moon-fixed vectors of ${yearSite.id} re-projected to this point)`, dataHash: input.yearSha256,
      precision: 'global screening estimate', coverageWarnings: warnings,
    },
  }
  return input.skipSeason ? data : { ...data, season: { ...seasonFromSeries(ephemeris, horizon), siteId: id } }
}
