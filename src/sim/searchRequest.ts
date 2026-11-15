/**
 * Search requests as plain data (structured-clone safe), so the same request runs in a Web
 * Worker or, without Worker support, on the main thread. The research profiles come from A's
 * data product when it exists; until then pass none and every place stays `unknown`.
 */
import type { EphemerisDoc, SiteData } from '../data/contract.ts'
import type { CellHorizons, ExtendedHeader, RefinedDoc } from '../data/extended.ts'
import type { MissionSettings } from './evaluate.ts'
import type { ResearchProfile } from './research.ts'
import { findMissionForPlace } from './missionPlanner.ts'
import { findSouthernPlaces, type HemisphereInput } from './hemisphere.ts'
import { cataloguePlaces, cellPlaces, findDatesForPlace, findNearbyEquivalentPlaces, findPlacesForDate } from './search.ts'
import type { DateSearchInput, PlaceSource, SearchOptions, SearchResult, SearchMetric, ResearchGoal } from './search.ts'

export interface CellSource {
  base: SiteData
  year: EphemerisDoc
  cells: CellHorizons
  /** `extended.json` (shared Moon-fixed cache, provenance) and `refined.json` (0.1° finalists). */
  header?: ExtendedHeader
  refined?: RefinedDoc | null
  /** Only these cells (row, col); all cells when omitted. */
  only?: [number, number][]
}

interface PlacesCommon {
  catalogue: SiteData[]
  cellSources: CellSource[]
  settings: MissionSettings
  startUtc: string
  sortBy?: SearchMetric
  objective?: ResearchProfile | null
  goal?: ResearchGoal | null
  profiles?: Record<string, ResearchProfile>
  coverage?: string
}

export type SearchRequest =
  | ({ kind: 'hemisphere' } & HemisphereInput)
  | ({ kind: 'mission'; maxDurationDays: number } & DateSearchInput)
  | ({ kind: 'dates' } & Omit<DateSearchInput, 'profile'> & { profile?: ResearchProfile | null })
  | ({ kind: 'places' } & PlacesCommon)
  | ({ kind: 'nearby'; origin: { siteId: string; latDeg: number; lonDeg: number }; maxDistanceM: number } & PlacesCommon)

function placesOf(r: PlacesCommon): PlaceSource[] {
  const out = cataloguePlaces(r.catalogue)
  for (const c of r.cellSources) {
    const only = c.only ? new Set(c.only.map(([row, col]) => `${row},${col}`)) : null
    out.push(...cellPlaces(c.base, c.year, c.cells, { header: c.header, refined: c.refined, filter: only ? (row, col) => only.has(`${row},${col}`) : undefined }))
  }
  if (r.profiles) for (const p of out) p.profile = r.profiles[p.siteId] ?? null
  return out
}

/** Runs a request on the current thread. */
export function runSearchRequest(r: SearchRequest, opts: SearchOptions = {}): Promise<SearchResult> {
  if (r.kind === 'hemisphere') return findSouthernPlaces(r, opts)
  if (r.kind === 'mission') return findMissionForPlace(r, opts)
  if (r.kind === 'dates') return findDatesForPlace(r, opts)
  const places = placesOf(r)
  if (r.kind === 'places') return findPlacesForDate({ ...r, places }, opts)
  return findNearbyEquivalentPlaces({ ...r, places }, opts)
}
