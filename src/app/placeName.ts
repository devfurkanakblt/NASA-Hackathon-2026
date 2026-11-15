/**
 * Plain names for the places a scenario can use: a catalogue site, or a regional map point given
 * as `Site01:r36c32` ("630 m north-east of Site01").
 */
import type { SiteData } from '../data/contract.ts'
import { parseCellId } from './extendedSites.ts'
import { parseFreePointId } from '../sim/freePoint.ts'
import { fmtLatLon } from './format.ts'

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
  if (free) return `Your point ${fmtLatLon(free.latDeg, free.lonDeg)}`
  const cell = parseCellId(id)
  if (cell) {
    const base = bySite[cell.siteId]?.site.name
    return base ? `Map point near ${base}` : 'Map point'
  }
  return bySite[id]?.site.name ?? id
}

/** Latitude and longitude of a free point or catalogue site; null for a map point (no own entry). */
export function placeLatLon(id: string, bySite: Record<string, SiteData>): { latDeg: number; lonDeg: number } | null {
  const free = parseFreePointId(id)
  if (free) return free
  const site = bySite[id]?.site
  return site ? { latDeg: site.latDeg, lonDeg: site.lonDeg } : null
}

/** "15 Nov 2026 06:00" (UTC); minutes only when not midnight. */
function shortUtc(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return d.getUTCHours() || d.getUTCMinutes() ? `${day} ${d.toISOString().slice(11, 16)} UTC` : day
}

/**
 * Title for a scenario in chips and lists: the place, plus its start date when another scenario
 * uses the same place (so "B Shackleton Rim" and "C Shackleton Rim" can be told apart).
 */
export function scenarioTitle(s: { key: string; siteId: string; startUtc: string }, all: { key: string; siteId: string }[], bySite: Record<string, SiteData>): string {
  const title = placeTitle(s.siteId, bySite)
  return all.some(o => o.key !== s.key && o.siteId === s.siteId) ? `${title} · ${shortUtc(s.startUtc)}` : title
}
