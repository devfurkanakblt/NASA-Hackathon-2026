import type { SiteData } from '../data/contract.ts'
import { loadHeader, loadYear } from '../data/extended.ts'
import { loadGlobalDemAround } from '../data/globalDem.ts'
import { FREE_RANGE_M, freePointId, freePointSiteData, parseFreePointId } from './freePoint.ts'
import type { MissionSettings } from './evaluate.ts'
import { validateSettings } from './evaluate.ts'
import { cataloguePlaces, compareCandidates, findPlacesForDate, METRICS, type SearchCandidate, type SearchMetric, type SearchOptions, type SearchResult } from './search.ts'

export type SearchRegion = 'polar' | 'hemisphere'

/** Northern edge of each search region, degrees latitude (inclusive for the polar region). */
export const REGION_NORTH_LIMIT_DEG: Record<SearchRegion, number> = { polar: -60, hemisphere: 0 }

export const REGION_LABEL: Record<SearchRegion, string> = {
  polar: 'South polar region (60°S–90°S)',
  hemisphere: 'Entire southern hemisphere',
}

export interface HemisphereInput {
  reference: SiteData
  startUtc: string
  settings: MissionSettings
  spacingDeg: number
  sortBy: SearchMetric
  /** Defaults to the south polar region, the focus of this tool. */
  region?: SearchRegion
}

/**
 * Latitude rings with approximately equal surface spacing; one point at the pole.
 * Rings stop south of the equator (or at `northLimitDeg`, inclusive, when it is below 0).
 */
export function hemisphereGrid(spacingDeg: number, northLimitDeg = 0): { latDeg: number; lonDeg: number }[] {
  if (![5, 10, 15].includes(spacingDeg)) throw new RangeError('Choose a grid spacing of 5, 10 or 15 degrees.')
  const points = [{ latDeg: -90, lonDeg: 0 }]
  for (let latDeg = -90 + spacingDeg; latDeg < 0 && latDeg <= northLimitDeg; latDeg += spacingDeg) {
    const count = Math.max(1, Math.ceil(360 * Math.cos(latDeg * Math.PI / 180) / spacingDeg))
    for (let i = 0; i < count; i++) points.push({ latDeg, lonDeg: -180 + 360 * i / count })
  }
  return points
}

/**
 * Feasible first, then the chosen metric, then — because many points tie on it (a battery that
 * never discharges stays at its starting charge everywhere in daylight) — end-of-mission charge,
 * the other two metrics, and finally the point closer to the south pole.
 */
export function regionOrder(sortBy: SearchMetric, latOf: (c: SearchCandidate) => number) {
  const primary = compareCandidates(sortBy)
  // "Smaller is better" keys on comparable scales (fractions; outage in days).
  const key: Record<SearchMetric, (m: NonNullable<SearchCandidate['metrics']>) => number> = {
    minSoc: m => -m.minSocFraction,
    bothVisible: m => -m.bothVisibleFraction,
    earthOutage: m => m.longestEarthOutageS / 86400,
  }
  const order: SearchMetric[] = [sortBy, ...(['minSoc', 'bothVisible', 'earthOutage'] as SearchMetric[]).filter(m => m !== sortBy)]
  return (a: SearchCandidate, b: SearchCandidate): number => {
    const f = Number(b.feasible) - Number(a.feasible) || a.failures.length - b.failures.length
    if (f) return f
    if (a.metrics && b.metrics) {
      const first = key[sortBy](a.metrics) - key[sortBy](b.metrics)
      if (Math.abs(first) > TIE) return first
      const fin = (b.summary?.finalSocFraction ?? 0) - (a.summary?.finalSocFraction ?? 0)
      if (Math.abs(fin) > TIE) return fin
      for (const m of order.slice(1)) {
        const d = key[m](a.metrics) - key[m](b.metrics)
        if (Math.abs(d) > TIE) return d
      }
      const lat = latOf(a) - latOf(b)
      if (lat) return lat
    }
    return primary(a, b)
  }
}

/** Metric differences smaller than this count as a tie (0.01 % or ~9 s of outage). */
export const TIE = 1e-4

/** How many leading feasible candidates tie with the first on the chosen metric. */
export function leadingTies(feasible: SearchCandidate[], sortBy: SearchMetric): number {
  const v = (c: SearchCandidate) => sortBy === 'minSoc' ? c.metrics!.minSocFraction : sortBy === 'bothVisible' ? c.metrics!.bothVisibleFraction : c.metrics!.longestEarthOutageS / 86400
  if (!feasible[0]?.metrics) return 0
  let n = 1
  while (n < feasible.length && feasible[n].metrics && Math.abs(v(feasible[n]) - v(feasible[0])) <= TIE) n++
  return n
}

/** Shared terrain/ephemeris source for mission and research searches. */
export async function southernPointBuilder(input: Pick<HemisphereInput, 'reference' | 'settings' | 'startUtc'>, signal?: AbortSignal) {
  const issues = validateSettings(input.settings)
  if (issues.length) throw new RangeError(issues.join(' '))
  const id = input.reference.site.id
  const [header, year] = await Promise.all([loadHeader(id), loadYear(id)])
  const startIndex = Math.round((Date.parse(input.startUtc) - Date.parse(year.startUtc)) / (year.stepS * 1000))
  const count = Math.round(input.settings.durationDays * 86400 / year.stepS) + 1
  if (!Number.isFinite(startIndex) || startIndex < 0 || startIndex + count > year.count) throw new RangeError('The entire mission must fit the reference ephemeris period.')
  return async (p: { latDeg: number; lonDeg: number }, azStepDeg: number) => {
    const dem = await loadGlobalDemAround(p.latDeg, p.lonDeg, FREE_RANGE_M, { signal })
    return freePointSiteData({ ...p, dem, year, yearSite: input.reference.site, yearSha256: header.year.sha256, window: { startIndex, count }, azStepDeg, skipSeason: true })
  }
}

export async function findSouthernPlaces(input: HemisphereInput, opts: SearchOptions = {}): Promise<SearchResult> {
  const started = Date.now()
  const region = input.region ?? 'polar'
  const northLimit = REGION_NORTH_LIMIT_DEG[region]
  const grid = hemisphereGrid(input.spacingDeg, northLimit)
  const build = await southernPointBuilder(input, opts.signal)
  const evaluated: SearchCandidate[] = []
  const seen = new Set<string>()
  const coordinates = new Map<string, { latDeg: number; lonDeg: number }>()
  let cancelled = false
  let tested = 0
  const test = async (p: { latDeg: number; lonDeg: number }, azStepDeg: number) => {
    const data = await build(p, azStepDeg)
    const r = await findPlacesForDate({ places: cataloguePlaces([data]), settings: input.settings, startUtc: input.startUtc, sortBy: input.sortBy })
    tested++
    return r.feasible[0] ?? r.rejected[0]
  }
  const latOf = (c: SearchCandidate) => coordinates.get(c.siteId)?.latDeg ?? parseFreePointId(c.siteId)?.latDeg ?? 0
  const order = regionOrder(input.sortBy, latOf)
  const scan = async (points: typeof grid) => {
    for (const p of points) {
      if (opts.signal?.aborted) { cancelled = true; break }
      const key = freePointId(p.latDeg, p.lonDeg)
      if (seen.has(key)) continue
      seen.add(key)
      coordinates.set(key, p)
      evaluated.push(await test(p, 1))
      opts.onProgress?.(tested, seen.size + points.length)
    }
  }
  await scan(grid)
  const centres = [...evaluated].sort(order).slice(0, 5)
  const fine: typeof grid = []
  for (const c of centres) {
    const p = coordinates.get(c.siteId)!
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const latDeg = p.latDeg + dy * input.spacingDeg / 5
      if (latDeg < -90 || latDeg >= 0 || latDeg > northLimit) continue
      const lonDeg = latDeg === -90 ? 0 : ((p.lonDeg + dx * input.spacingDeg / (5 * Math.max(0.1, Math.cos(latDeg * Math.PI / 180))) + 540) % 360) - 180
      fine.push({ latDeg, lonDeg })
    }
  }
  if (!cancelled) await scan(fine)
  const finalists: SiteData[] = []
  for (const c of [...evaluated].sort(order).slice(0, 10)) {
    if (opts.signal?.aborted) { cancelled = true; break }
    finalists.push(await build(coordinates.get(c.siteId)!, 0.1))
  }
  const result = await findPlacesForDate({ places: cataloguePlaces(finalists), settings: input.settings, startUtc: input.startUtc, sortBy: input.sortBy })
  result.feasible.sort(order)
  result.pareto = result.feasible.filter(c => c.pareto)
  result.best = result.status === 'complete' ? result.feasible[0] ?? null : null
  result.tested = tested + finalists.length
  const area = region === 'polar' ? 'South polar region (60°S–90°S)' : 'Entire southern hemisphere'
  result.spatialCoverage = { description: `${area}: ${input.spacingDeg}° rings, ${input.spacingDeg / 5}° local refinement around five screening leaders; ten finalists rechecked at 0.1° horizon sampling.`, places: seen.size }
  const ties = leadingTies(result.feasible, input.sortBy)
  const tieNote = ties > 1
    ? [`The top ${ties} locations tie on “${METRICS[input.sortBy].label.toLowerCase()}”. They are ordered by end-of-mission charge, then the other two metrics, then distance to the south pole.`]
    : []
  result.notes = [result.spatialCoverage.description, ...tieNote, 'Global LOLA terrain (~1.9 km/pixel), 250 km horizon range. Initial horizon sampling: 1°. Results rank rechecked finalists only; unsampled terrain and rejected screening points may contain better locations. This does not certify landing safety.', ...result.notes]
  result.elapsedMs = Date.now() - started
  if (cancelled) { result.status = 'cancelled'; result.best = null }
  return result
}
