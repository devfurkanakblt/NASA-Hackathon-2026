/**
 * Builds the search requests of the "Find a better date or place" panel from what the app has
 * loaded. Pure apart from the loaders passed in, so it is testable without a browser.
 *
 * - Dates: the chosen place on its longest available series (one-year file of a catalogue site,
 *   or the place's own full series), every valid start from the first to the last sample.
 * - Places: every catalogue site for the chosen start (one-year file where the mission ends after
 *   the two-month series), plus, on request, the ±3 km map points of the chosen place's site
 *   (A's shared Moon-fixed cache and 0.1° refined finalists).
 */
import type { EphemerisDoc, SiteData } from '../data/contract.ts'
import type { CellHorizons, ExtendedHeader, RefinedDoc } from '../data/extended.ts'
import { missionStartRange } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { parseFreePointId } from '../sim/freePoint.ts'
import type { SearchMetric } from '../sim/search.ts'
import type { SearchRequest } from '../sim/searchRequest.ts'
import { hasFullSeries, parseCellId } from './extendedSites.ts'

export interface Loaders {
  year: (siteId: string) => Promise<EphemerisDoc>
  header: (siteId: string) => Promise<ExtendedHeader>
  cells: (siteId: string) => Promise<CellHorizons>
  refined: (siteId: string) => Promise<RefinedDoc | null>
}

/** Only what the engine reads: no 3D terrain or display files travel to the search worker. */
export function engineOnly(d: SiteData): SiteData {
  return { site: d.site, ephemeris: d.ephemeris, horizon: d.horizon, map: d.map, provenance: d.provenance }
}

/** The place's longest series: its own full series, or the one-year file of a catalogue site. */
export async function longestData(data: SiteData, loaders: Loaders): Promise<SiteData> {
  const id = data.site.id
  if (parseCellId(id) || parseFreePointId(id) || hasFullSeries(data)) return data
  try {
    return { ...data, ephemeris: await loaders.year(id) }
  } catch {
    return data // two-month series only; the result says the range it covers
  }
}

export async function datesRequest(data: SiteData, settings: MissionSettings, sortBy: SearchMetric, loaders: Loaders): Promise<SearchRequest | { error: string }> {
  const full = await longestData(data, loaders)
  const range = missionStartRange(full.ephemeris, settings.durationDays)
  if (!range) return { error: `The data for this place is shorter than a ${settings.durationDays}-day mission.` }
  return { kind: 'dates', data: engineOnly(full), settings, fromUtc: range.firstStartUtc, toUtc: range.lastStartUtc, sortBy }
}

export interface PlacesOptions {
  /** Also test every ±3 km map point around this catalogue site. */
  mapOf?: string | null
  onProgress?: (done: number, total: number) => void
}

export async function placesRequest(startUtc: string, settings: MissionSettings, sortBy: SearchMetric, bySite: Record<string, SiteData>, loaders: Loaders, opts: PlacesOptions = {}): Promise<SearchRequest> {
  const sites = Object.values(bySite).filter((d) => !hasFullSeries(d))
  const endMs = Date.parse(startUtc) + settings.durationDays * 86400000
  let done = 0
  const total = sites.length + (opts.mapOf ? 1 : 0)
  const catalogue = await Promise.all(
    sites.map(async (d) => {
      const e = d.ephemeris
      const twoMonthEnd = Date.parse(e.startUtc) + (e.count - 1) * e.stepS * 1000
      const out = endMs <= twoMonthEnd ? d : await longestData(d, loaders)
      opts.onProgress?.(++done, total)
      return engineOnly(out)
    }),
  )
  const cellSources: Extract<SearchRequest, { kind: 'places' }>['cellSources'] = []
  if (opts.mapOf && bySite[opts.mapOf]?.map) {
    const id = opts.mapOf
    const [year, header, cells, refined] = await Promise.all([loaders.year(id), loaders.header(id), loaders.cells(id), loaders.refined(id).catch(() => null)])
    cellSources.push({ base: engineOnly(bySite[id]), year, cells, header, refined })
    opts.onProgress?.(++done, total)
  }
  const n = cellSources[0]?.cells.n ?? 0
  return {
    kind: 'places',
    catalogue,
    cellSources,
    settings,
    startUtc,
    sortBy,
    coverage: `${catalogue.length} catalogue sites${n ? ` and ${n} map points around ${opts.mapOf}` : ''}`,
  }
}
