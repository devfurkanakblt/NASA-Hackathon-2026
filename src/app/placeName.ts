/**
 * Plain names for the places a scenario can use: a catalogue site, or a regional map point given
 * as `Site01:r36c32` ("630 m north-east of Site01").
 */
import type { SiteData } from '../data/contract.ts'
import { parseCellId } from './extendedSites.ts'
import { parseFreePointId } from '../sim/freePoint.ts'

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** "630 m north-east of Site01", or null when the id is not a map point of a known site. */
export function mapPointWhere(id: string, bySite: Record<string, SiteData>): string | null {
  const cell = parseCellId(id)
  const map = cell ? bySite[cell.siteId]?.map : undefined
  if (!cell || !map) return null
  const { spacingM, halfSizeM } = map.grid
  const east = -halfSizeM + cell.col * spacingM
  const north = -halfSizeM + cell.row * spacingM
  const dist = Math.hypot(east, north)
  if (dist === 0) return `centre of ${cell.siteId}'s map`
  const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
  const dir = COMPASS[Math.round(bearing / 45) % 8]
  const len = dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1)} km`
  return `${len} ${dir} of ${cell.siteId}`
}

/** Title for cards and lists: the site name, or "Map point near Connecting Ridge". */
export function placeTitle(id: string, bySite: Record<string, SiteData>): string {
  const free = parseFreePointId(id)
  if (free) {
    const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`
    return `Your point ${f(free.latDeg, 'N', 'S')}, ${f(free.lonDeg, 'E', 'W')}`
  }
  const cell = parseCellId(id)
  if (cell) {
    const base = bySite[cell.siteId]?.site.name
    return base ? `Map point near ${base}` : 'Map point'
  }
  return bySite[id]?.site.name ?? id
}
