import { arcM } from '../app/mapGrid.ts'
import { normalizeLon, snapToCell } from '../app/extendedSites.ts'
import type { CoverageDoc, SiteData } from './contract.ts'

/** A point this close to a catalogue coordinate is that catalogue site. */
export const CATALOGUE_MATCH_M = 1

export interface PointCoverage {
  kind: 'catalogue' | 'map-cell' | 'outside'
  siteId?: string
  snappedLatDeg?: number
  snappedLonDeg?: number
  distanceM?: number
  message: string
}

function fail(source: string, path: string, expected: string): never {
  throw new Error(`${source}: ${path} must be ${expected}`)
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, source: string, path: string, min = -Infinity, max = Infinity) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(source, path, 'a finite number in range')
  return v
}
const utc = (v: unknown, source: string, path: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v) || Number.isNaN(Date.parse(v))) fail(source, path, 'a UTC timestamp')
  return Date.parse(v)
}

export function validateCoverage(value: unknown, source = 'coverage.json'): CoverageDoc {
  if (!isObj(value) || value.version !== 1) fail(source, 'version', '1')
  const t = value.time
  if (!isObj(t)) fail(source, 'time', 'an object')
  const start = utc(t.startUtc, source, 'time.startUtc')
  const end = utc(t.endUtc, source, 'time.endUtc')
  const main = utc(t.mainPeriodEndUtc, source, 'time.mainPeriodEndUtc')
  num(t.stepS, source, 'time.stepS', 1)
  if (!(start < main && main <= end)) fail(source, 'time', 'ordered start < mainPeriodEnd <= end')
  if (!Array.isArray(value.catalogue)) fail(source, 'catalogue', 'an array')
  for (const c of value.catalogue) {
    if (!isObj(c) || typeof c.siteId !== 'string') fail(source, 'catalogue[]', 'an object with siteId')
    num(c.latDeg, source, 'catalogue.latDeg', -90, 90)
    num(c.lonDeg, source, 'catalogue.lonDeg', -180, 180)
    num(c.horizonResolutionDeg, source, 'catalogue.horizonResolutionDeg', Number.MIN_VALUE)
  }
  if (!Array.isArray(value.maps)) fail(source, 'maps', 'an array')
  for (const m of value.maps) {
    if (!isObj(m) || typeof m.siteId !== 'string') fail(source, 'maps[]', 'an object with siteId')
    for (const k of ['halfSizeM', 'spacingM', 'horizonResolutionDeg', 'summaryResolutionDeg']) num(m[k], source, `maps.${k}`, Number.MIN_VALUE)
    if (!Array.isArray(m.summaryPeriod) || m.summaryPeriod.length !== 2) fail(source, 'maps.summaryPeriod', 'two timestamps')
    m.summaryPeriod.forEach((u, i) => utc(u, source, `maps.summaryPeriod[${i}]`))
  }
  if (!Array.isArray(value.dems)) fail(source, 'dems', 'an array')
  for (const d of value.dems) {
    if (!isObj(d) || typeof d.name !== 'string' || !['local-5m', 'regional-80m', 'global-474m'].includes(d.kind as string)) fail(source, 'dems[]', 'a DEM entry')
  }
  if (typeof value.freePoints !== 'string') fail(source, 'freePoints', 'a string')
  return value as unknown as CoverageDoc
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`

/** Classifies a typed coordinate against the supported maps; reuses `snapToCell`, which wraps longitude. */
export function pointCoverage(lat: number, lon: number, cov: CoverageDoc, bySite: Record<string, SiteData>): PointCoverage {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const cat = cov.catalogue.find(c => arcM(lat, normalizeLon(lon), c.latDeg, c.lonDeg) <= CATALOGUE_MATCH_M)
    if (cat) return { kind: 'catalogue', siteId: cat.siteId, snappedLatDeg: cat.latDeg, snappedLonDeg: cat.lonDeg, distanceM: 0,
      message: `Catalogue site ${cat.siteId}.` }
  }
  const snap = snapToCell(lat, lon, bySite)
  if (!('error' in snap)) {
    const map = bySite[snap.siteId].map!
    const i = snap.row * map.grid.nx + snap.col
    return { kind: 'map-cell', siteId: snap.siteId, snappedLatDeg: map.latDeg[i], snappedLonDeg: map.lonDeg[i], distanceM: snap.distanceM,
      message: `Snapped to the nearest ${snap.siteId} map cell, ${snap.distanceM.toFixed(0)} m away.` }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) return { kind: 'outside', message: snap.error }
  // nearest supported map: nearest cell when the map is loaded, else its centre
  const nlon = normalizeLon(lon)
  let best: { siteId: string; d: number } | undefined
  for (const m of cov.maps) {
    const map = bySite[m.siteId]?.map
    let d = Infinity
    if (map) for (let i = 0; i < map.latDeg.length; i++) d = Math.min(d, arcM(lat, nlon, map.latDeg[i], map.lonDeg[i]))
    else {
      const c = cov.catalogue.find(x => x.siteId === m.siteId)
      if (c) d = Math.max(0, arcM(lat, nlon, c.latDeg, c.lonDeg) - m.halfSizeM)
    }
    if (!best || d < best.d) best = { siteId: m.siteId, d }
  }
  if (!best) return { kind: 'outside', message: 'No supported map is available.' }
  return { kind: 'outside', siteId: best.siteId, distanceM: best.d,
    message: `Outside the supported maps. The nearest is ${best.siteId}, ${km(best.d)} away.` }
}
