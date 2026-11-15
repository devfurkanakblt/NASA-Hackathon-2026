/**
 * Turning a typed or clicked coordinate into a scenario place, and computing free points.
 *
 * Order (best data first, never a silent move):
 *   1. a catalogue site within 1 m → that site (0.1° catalogue horizon);
 *   2. inside a ±3 km polar map → the nearest map cell, and the message says how far it is
 *      (5 m DEM 1° horizon, or the 0.1° refined horizon where A has revalidated it);
 *   3. anywhere else on the Moon → this exact coordinate as a free point (`pt:lat:lon`), computed
 *      in the browser from the global LOLA terrain: a "global screening estimate".
 */
import type { SiteData } from '../data/contract.ts'
import { loadHeader, loadYear } from '../data/extended.ts'
import { loadGlobalDemAround } from '../data/globalDem.ts'
import { FREE_RANGE_M, freePointId, freePointSiteData, parseFreePointId } from '../sim/freePoint.ts'
import { arcDistanceM } from '../sim/research.ts'
import { cellId, normalizeLon, snapToCell } from './extendedSites.ts'
import { mapPointWhere } from './placeName.ts'

/** The site whose one-year series supplies the Moon-fixed Sun / Earth vectors. Any site works. */
export const REFERENCE_YEAR_SITE = 'Site01'

export type PlaceChoice = { siteId: string; kind: 'catalogue' | 'map-cell' | 'free'; message: string } | { error: string }

export function placeForCoordinate(latDeg: number, lonDeg: number, bySite: Record<string, SiteData>): PlaceChoice {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return { error: 'Enter latitude and longitude in degrees.' }
  if (latDeg < -90 || latDeg > 90) return { error: 'Latitude must be between −90° and 90°.' }
  const lon = normalizeLon(lonDeg)
  for (const d of Object.values(bySite)) {
    if (arcDistanceM(latDeg, lon, d.site.latDeg, d.site.lonDeg) <= 1) return { siteId: d.site.id, kind: 'catalogue', message: `This is the catalogue site ${d.site.name}.` }
  }
  const snap = snapToCell(latDeg, lon, bySite)
  if (!('error' in snap)) {
    const id = cellId(snap.siteId, snap.row, snap.col)
    return {
      siteId: id,
      kind: 'map-cell',
      message: `Inside the detailed ±3 km map of ${snap.siteId}: uses the map spot ${mapPointWhere(id, bySite) ?? id}, ${Math.round(snap.distanceM)} m from your point (local 5 m terrain).`,
    }
  }
  return {
    siteId: freePointId(latDeg, lon),
    kind: 'free',
    message: 'Computed for this exact coordinate from the global LOLA terrain (~1.9 km per pixel): a screening estimate. Small hills and crater walls are not resolved.',
  }
}

/** Builds the engine input of a free point: global DEM tiles around it + the reference one-year series. */
export async function computeFreePoint(id: string, bySite: Record<string, SiteData>, signal?: AbortSignal): Promise<SiteData> {
  const p = parseFreePointId(id)
  if (!p) throw new RangeError(`${id} is not a free coordinate.`)
  const ref = bySite[REFERENCE_YEAR_SITE]
  if (!ref) throw new Error(`Reference site ${REFERENCE_YEAR_SITE} is not loaded.`)
  const [header, year, dem] = await Promise.all([loadHeader(REFERENCE_YEAR_SITE), loadYear(REFERENCE_YEAR_SITE), loadGlobalDemAround(p.latDeg, p.lonDeg, FREE_RANGE_M, { signal })])
  return freePointSiteData({ latDeg: p.latDeg, lonDeg: p.lonDeg, dem, year, yearSite: ref.site, yearSha256: header.year.sha256 })
}
