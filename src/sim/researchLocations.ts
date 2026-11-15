import type { Psr, SiteData } from '../data/contract.ts'
import { loadYear } from '../data/extended.ts'
import { evaluateScenario, type MissionSettings } from './evaluate.ts'
import { freePointId } from './freePoint.ts'
import { hemisphereGrid, southernPointBuilder } from './hemisphere.ts'
import { arcDistanceM, MAX_ALTERNATIVE_SLOPE_DEG, RESEARCH_TYPES, researchMetrics, type Fit, type ResearchMetrics, type ResearchType } from './research.ts'
import { constraintFailures, precisionOf, type ConstraintFailure, type SearchOptions } from './search.ts'

export interface ResearchLocation {
  metrics: ResearchMetrics
  name: string
  precisionLabel: string
  failures: ConstraintFailure[]
}
export interface RankedResearchLocation extends ResearchLocation {
  fit: Fit
  value: string
  distanceKm: number
  comparison: 'better' | 'equal' | 'lower'
}
export interface ResearchLocationsInput {
  reference: SiteData
  catalogue: SiteData[]
  selected: ResearchMetrics
  typeIds: ResearchType['id'][]
  psrs: Psr[]
  startUtc: string
  settings: MissionSettings
}
export interface ResearchLocationsResult {
  rankings: Partial<Record<ResearchType['id'], RankedResearchLocation[]>>
  testedLocations: number
  skippedCatalogue: number
  notes: string[]
}

const fitOrder: Record<Fit, number> = { strong: 2, possible: 1, no: 0 }
/** Research merit is independent of mission feasibility; neither is hidden from the user. */
export function rankResearchLocations(type: ResearchType, selected: ResearchMetrics, candidates: ResearchLocation[], limit = 3): RankedResearchLocation[] {
  const current = type.assess(selected)
  return candidates
    .filter(c => c.metrics.latDeg < 0 && arcDistanceM(selected.latDeg, selected.lonDeg, c.metrics.latDeg, c.metrics.lonDeg) > 1)
    .filter(c => c.metrics.slopeDeg === null || c.metrics.slopeDeg <= MAX_ALTERNATIVE_SLOPE_DEG)
    .map(c => {
      const assessment = type.assess(c.metrics)
      const difference = fitOrder[assessment.fit] - fitOrder[current.fit] || type.score(c.metrics) - type.score(selected)
      return { ...c, ...assessment, distanceKm: arcDistanceM(selected.latDeg, selected.lonDeg, c.metrics.latDeg, c.metrics.lonDeg) / 1000, comparison: difference > 0 ? 'better' as const : difference < 0 ? 'lower' as const : 'equal' as const }
    })
    .filter(c => c.fit !== 'no')
    .sort((a, b) => fitOrder[b.fit] - fitOrder[a.fit] || type.score(b.metrics) - type.score(a.metrics) || a.distanceKm - b.distanceKm || a.metrics.siteId.localeCompare(b.metrics.siteId))
    .filter((c, i, all) => all.findIndex(other => arcDistanceM(c.metrics.latDeg, c.metrics.lonDeg, other.metrics.latDeg, other.metrics.lonDeg) <= 1) === i)
    .slice(0, limit)
}

export async function findResearchLocations(input: ResearchLocationsInput, opts: SearchOptions = {}): Promise<ResearchLocationsResult> {
  const types = RESEARCH_TYPES.filter(t => input.typeIds.includes(t.id))
  if (!types.length) return { rankings: {}, testedLocations: 0, skippedCatalogue: 0, notes: [] }
  const check = () => { if (opts.signal?.aborted) throw new DOMException('Search cancelled.', 'AbortError') }
  check()
  const build = await southernPointBuilder(input, opts.signal)
  const screening: ResearchLocation[] = []
  const exact: ResearchLocation[] = []
  const seen = new Set<string>()
  let skippedCatalogue = 0
  const measure = (data: SiteData): ResearchLocation => {
    const result = evaluateScenario(data, input.startUtc, input.settings)
    return { metrics: researchMetrics(data, result, input.psrs), name: data.site.name, precisionLabel: precisionOf(data, 'catalogue').label, failures: constraintFailures(result.summary, input.settings) }
  }
  for (const base of input.catalogue.filter(d => d.site.latDeg < 0)) {
    check()
    try {
      const end = Date.parse(base.ephemeris.startUtc) + (base.ephemeris.count - 1) * base.ephemeris.stepS * 1000
      const needYear = Date.parse(input.startUtc) < Date.parse(base.ephemeris.startUtc) || Date.parse(input.startUtc) + input.settings.durationDays * 86400000 > end
      const data = needYear && base.site.category !== 'custom' ? { ...base, ephemeris: await loadYear(base.site.id) } : base
      exact.push(measure(data))
    } catch { skippedCatalogue++ }
  }
  const scan = async (points: { latDeg: number; lonDeg: number }[]) => {
    const todo = [...new Map(points.filter(p => p.latDeg >= -90 && p.latDeg < 0).map(p => [freePointId(p.latDeg, p.lonDeg), p])).entries()].filter(([id]) => !seen.has(id))
    const planned = seen.size + todo.length
    for (const [id, p] of todo) {
      check()
      screening.push(measure(await build(p, 1)))
      seen.add(id)
      opts.onProgress?.(seen.size, planned)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }
  // PSR seeds are essential: a broad angular grid can miss small polar science targets.
  const psrSeeds = types.some(t => t.id === 'ice') ? input.psrs.flatMap(p => {
    const radiusDeg = Math.sqrt(p.areaKm2 / Math.PI) / 1737.4 * 180 / Math.PI
    return [{ latDeg: p.latDeg, lonDeg: p.lonDeg }, ...[0, 90, 180, 270].map(bearing => {
      const phi = p.latDeg * Math.PI / 180, delta = radiusDeg * Math.PI / 180, b = bearing * Math.PI / 180
      const lat = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(b))
      const lon = p.lonDeg + Math.atan2(Math.sin(b) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(lat)) * 180 / Math.PI
      return { latDeg: lat * 180 / Math.PI, lonDeg: ((lon + 540) % 360) - 180 }
    })]
  }) : []
  await scan([...hemisphereGrid(15), ...psrSeeds])
  const leaders = types.flatMap(t => rankResearchLocations(t, input.selected, [...screening, ...exact], 3))
  const fine = leaders.flatMap(c => {
    const points = []
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const latDeg = c.metrics.latDeg + dy * 3
      const lonDeg = latDeg === -90 ? 0 : ((c.metrics.lonDeg + dx * 3 / Math.max(0.1, Math.cos(latDeg * Math.PI / 180)) + 540) % 360) - 180
      points.push({ latDeg, lonDeg })
    }
    return points
  })
  await scan(fine)
  const finalists = new Map(types.flatMap(t => rankResearchLocations(t, input.selected, screening, 6)).map(c => [c.metrics.siteId, c]))
  let done = 0
  for (const c of finalists.values()) {
    check()
    exact.push(measure(await build(c.metrics, 0.1)))
    opts.onProgress?.(++done, finalists.size)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  check()
  return {
    rankings: Object.fromEntries(types.map(t => [t.id, rankResearchLocations(t, input.selected, exact)])),
    testedLocations: seen.size + input.catalogue.length - skippedCatalogue,
    skippedCatalogue,
    notes: [
      'Same landing date, duration and hardware. Research types are ranked separately by their displayed criterion; mission feasibility is reported separately.',
      'Southern hemisphere: 15° surface grid, 3° local latitude refinement around three leaders per research type; mapped PSR centres and approximate edges included for ice research. Six screening finalists per type rechecked with 0.1° horizon sampling, alongside catalogue locations.',
      'Global terrain is ~1.9 km/pixel; small terrain hazards and exact traversable routes are unresolved. Rankings cover tested finalists, not every surface point. Global-point slope and full-year radio shielding are unverified; PSR distance uses an equal-area circle, not a confirmed ice deposit.',
    ],
  }
}
