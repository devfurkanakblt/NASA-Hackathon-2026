/**
 * The two searches (plan madde 4, D):
 *
 * - `findDatesForPlace`: fixed place, hardware and duration; the mission start moves.
 * - `findPlacesForDate`: fixed UTC start, hardware and duration; the place moves over the
 *   supported candidates (catalogue sites and/or the ±3 km map cells of a site).
 * - `findNearbyEquivalentPlaces`: places within a stated distance of the first place that keep
 *   its research objective (research.ts).
 *
 * Every candidate runs through the unchanged `evaluateScenario`. Order of decisions:
 *   1. data is there and finite (and, with an objective, the research rule is not `incompatible`);
 *   2. hard limits for the whole mission: battery reserve kept, no unmet demand, longest Earth
 *      outage within the user's limit — never relaxed automatically;
 *   3. the passing candidates are compared on separate visible metrics. No hidden total score:
 *      the Pareto set is kept (nothing equal or non-dominated is dropped) and the list is sorted
 *      by the one metric the user picks, with a deterministic tie order.
 *
 * "Best" only ever means "best among the tested starts / places for the chosen metric".
 * A cancelled or over-budget search is returned as `partial`, never as a finished answer.
 */
import type { SiteData } from '../data/contract.ts'
import type { Provenance } from '../data/contract.ts'
import type { CellHorizons, ExtendedHeader, RefinedDoc } from '../data/extended.ts'
import { cellHorizon } from '../data/extended.ts'
import { cellEphemerisSlice, centreObserver, CELL_LABEL, REFINED_CELL_LABEL, usableRefined } from './cell.ts'
import { moonFixedKey, moonFixedSeries, projectWindow } from './moonFixed.ts'
import { CoverageError, SettingsError, evaluateScenario, validateSettings } from './evaluate.ts'
import type { MissionSettings, ScenarioSummary } from './evaluate.ts'
import { arcDistanceM, compareResearch, RESEARCH_UNVERIFIED } from './research.ts'
import type { ResearchDecision, ResearchProfile } from './research.ts'

export type SearchMetric = 'minSoc' | 'bothVisible' | 'earthOutage'

export const METRICS: Record<SearchMetric, { label: string; better: 'higher' | 'lower' }> = {
  minSoc: { label: 'Lowest battery charge during the mission', better: 'higher' },
  bothVisible: { label: 'Time with Sun and Earth both in view', better: 'higher' },
  earthOutage: { label: 'Longest time without Earth in view', better: 'lower' },
}

/** Unmet demand below this counts as zero (floating-point noise, about 0.3 mWh). */
export const UNMET_TOLERANCE_J = 1

export type FailureCode = 'data' | 'coverage' | 'research' | 'reserve' | 'unmet' | 'earthOutage'

export interface ConstraintFailure {
  code: FailureCode
  message: string
}

export interface CandidateMetrics {
  minSocFraction: number
  bothVisibleFraction: number
  longestEarthOutageS: number
}

/** `refined`: a map cell revalidated with the 0.1° catalogue horizon (refined.json). */
export type Precision = 'catalogue' | 'cell' | 'refined' | 'free'

export interface SearchCandidate {
  siteId: string
  /** Mission start actually used (on the data's 10-minute grid). */
  startUtc: string
  precision: Precision
  /** Plain description of the horizon resolution behind the numbers. */
  precisionLabel: string
  metrics: CandidateMetrics | null
  summary: ScenarioSummary | null
  feasible: boolean
  failures: ConstraintFailure[]
  /** Not dominated by any other feasible candidate (always false for infeasible ones). */
  pareto: boolean
  research: ResearchDecision
  /** Distance from the search origin, when there is one. */
  distanceM?: number
}

export type SearchStatus = 'complete' | 'cancelled' | 'partial'

export interface SearchResult {
  kind: 'dates' | 'places' | 'nearby'
  status: SearchStatus
  /** Requested time range (dates) or the fixed start (places). */
  searchedRange: { fromUtc: string; toUtc: string }
  /** Starts actually tested: coarse step and refinement steps, in seconds. */
  timeStep: { coarseS: number | null; refineS: number[] }
  /** Which places were searched, in words, and how many. */
  spatialCoverage: { description: string; places: number }
  objectiveId: string | null
  sortBy: SearchMetric
  tested: number
  /** Feasible candidates, sorted by `sortBy` (ties: earlier start, then site id). */
  feasible: SearchCandidate[]
  /** The non-dominated feasible candidates, same order. */
  pareto: SearchCandidate[]
  /** Up to `maxRejected` infeasible candidates (closest to passing first), for "why not?". */
  rejected: SearchCandidate[]
  /** How many tested candidates failed each condition. */
  failureCounts: Partial<Record<FailureCode, number>>
  /** First feasible candidate for `sortBy`; `null` when nothing passed or the search did not finish. */
  best: SearchCandidate | null
  /**
   * Pareto map-cell finalists still on the 1° screening horizon, per site, for A's
   * `python -m preprocess.refine_cells`. Until refined they stay "regional screening estimate".
   */
  refineSuggestions: { siteId: string; cells: string[] }[]
  /** Plain sentences for the result panel: scope, labels, why nothing was found. */
  notes: string[]
  /** Wall time of the search, ms. */
  elapsedMs: number
}

export interface SearchOptions {
  signal?: AbortSignal
  /** Called after every chunk: candidates done / planned so far. */
  onProgress?: (done: number, planned: number) => void
  /** Stop after this much wall time and return `partial`. */
  budgetMs?: number
  /** Candidates per chunk between yields to the event loop. */
  chunkSize?: number
  /** Infeasible candidates returned in `rejected`. */
  maxRejected?: number
}

// ---------------------------------------------------------------------------------------------
// Feasibility and Pareto

export function metricsOf(s: ScenarioSummary): CandidateMetrics {
  return { minSocFraction: s.minSocFraction, bothVisibleFraction: s.bothVisibleFraction, longestEarthOutageS: s.longestEarthOutageS }
}

const fmtH = (s: number) => `${(s / 3600).toFixed(1)} h`

/** Hard-limit failures of one mission result; empty when the mission passes. */
export function constraintFailures(s: ScenarioSummary, settings: MissionSettings): ConstraintFailure[] {
  const out: ConstraintFailure[] = []
  const values = [s.minSocFraction, s.unmetEnergyJ, s.longestEarthOutageS, s.bothVisibleFraction, s.sunVisibleFraction, s.earthVisibleFraction]
  if (!values.every(Number.isFinite)) return [{ code: 'data', message: 'The result has a missing or non-finite value.' }]
  if (!s.keepsBatteryReserve) out.push({ code: 'reserve', message: `Battery drops to ${(100 * s.minSocFraction).toFixed(1)} %, below the ${(100 * settings.reserveFraction).toFixed(0)} % reserve.` })
  if (s.unmetEnergyJ > UNMET_TOLERANCE_J) out.push({ code: 'unmet', message: `${(s.unmetEnergyJ / 3.6e6).toFixed(2)} kWh of demand cannot be served.` })
  if (!s.earthOutageWithinLimit) out.push({ code: 'earthOutage', message: `Earth out of view for up to ${fmtH(s.longestEarthOutageS)}; the limit is ${fmtH(settings.maxEarthOutageH * 3600)}.` })
  return out
}

/** `a` dominates `b`: not worse in any metric and better in at least one. */
export function dominates(a: CandidateMetrics, b: CandidateMetrics): boolean {
  const ge = a.minSocFraction >= b.minSocFraction && a.bothVisibleFraction >= b.bothVisibleFraction && a.longestEarthOutageS <= b.longestEarthOutageS
  const gt = a.minSocFraction > b.minSocFraction || a.bothVisibleFraction > b.bothVisibleFraction || a.longestEarthOutageS < b.longestEarthOutageS
  return ge && gt
}

/** Marks `pareto` on the feasible candidates (in place). Equal candidates are all kept. */
export function markPareto(list: SearchCandidate[]): void {
  const feasible = list.filter((c) => c.feasible && c.metrics)
  for (const c of list) c.pareto = false
  for (const c of feasible) c.pareto = !feasible.some((o) => o !== c && dominates(o.metrics!, c.metrics!))
}

export function metricValue(m: CandidateMetrics, metric: SearchMetric): number {
  return metric === 'minSoc' ? m.minSocFraction : metric === 'bothVisible' ? m.bothVisibleFraction : m.longestEarthOutageS
}

/** Fixed order of the other visible metrics, used only to break ties of the chosen one. */
const TIE_ORDER: SearchMetric[] = ['earthOutage', 'minSoc', 'bothVisible']

/**
 * Sort by the chosen metric (better first); ties by the other visible metrics in a fixed order
 * (shorter Earth outage, higher lowest charge, more Sun+Earth time), then earlier start, then site
 * id: deterministic, and an alphabetical name never decides between options that differ.
 */
export function compareCandidates(metric: SearchMetric) {
  const order = [metric, ...TIE_ORDER.filter((m) => m !== metric)]
  return (a: SearchCandidate, b: SearchCandidate): number => {
    if (a.metrics && b.metrics) {
      for (const m of order) {
        const sign = METRICS[m].better === 'higher' ? -1 : 1
        const d = sign * (metricValue(a.metrics, m) - metricValue(b.metrics, m))
        if (d !== 0) return d
      }
    } else if (a.metrics || b.metrics) {
      return a.metrics ? -1 : 1
    }
    if (a.startUtc !== b.startUtc) return a.startUtc < b.startUtc ? -1 : 1
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  }
}

// ---------------------------------------------------------------------------------------------
// Running candidates

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
const yieldNow = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const CATALOGUE_PRECISION = 'Catalogue site: 0.1° terrain horizon'
const CELL_PRECISION = CELL_LABEL
const LABELS: Record<Precision, string> = { catalogue: CATALOGUE_PRECISION, cell: CELL_PRECISION, refined: REFINED_CELL_LABEL, free: 'Free coordinate: screening estimate' }

/** Precision of the data actually used, from its provenance when it has one. */
export function precisionOf(data: SiteData, fallback: Precision): { precision: Precision; label: string } {
  const p: Provenance | undefined = data.provenance
  if (!p) return { precision: fallback, label: LABELS[fallback] }
  if (p.horizonSource === 'refined-cell') return { precision: 'refined', label: REFINED_CELL_LABEL }
  if (p.horizonSource === 'map-cell') return { precision: 'cell', label: CELL_PRECISION }
  if (p.horizonSource === 'global-dem' || p.horizonSource === 'regional-dem') return { precision: 'free', label: data.site.label }
  const kind = data.site.category === 'custom' ? `Scientific package ${data.site.id}` : 'Catalogue site'
  const warn = p.coverageWarnings.length > 0 ? `; ${p.coverageWarnings.length} coverage warning(s)` : ''
  return { precision: 'catalogue', label: `${kind}: ${p.horizonResolutionDeg}° terrain horizon${warn}` }
}

interface Job {
  siteId: string
  startUtc: string
  precision: Precision
  distanceM?: number
  data: () => SiteData
  profile?: ResearchProfile | null
}

function runJob(job: Job, settings: MissionSettings, objective: ResearchProfile | null | undefined): SearchCandidate {
  let base = { siteId: job.siteId, precision: job.precision, precisionLabel: LABELS[job.precision], pareto: false, distanceM: job.distanceM }
  let data: SiteData
  let summary: ScenarioSummary
  let startUtc = job.startUtc
  try {
    data = job.data()
    const p = precisionOf(data, job.precision)
    base = { ...base, precision: p.precision, precisionLabel: p.label }
    const r = evaluateScenario(data, job.startUtc, settings)
    summary = r.summary
    startUtc = r.alignedStartUtc
  } catch (e) {
    if (e instanceof SettingsError) throw e
    const code: FailureCode = e instanceof CoverageError ? 'coverage' : 'data'
    const message = e instanceof Error ? e.message : String(e)
    return { ...base, startUtc, metrics: null, summary: null, feasible: false, failures: [{ code, message }], research: { match: 'unknown', reasons: [RESEARCH_UNVERIFIED + '.'] } }
  }
  const research = compareResearch(objective, job.profile, { latDeg: data.site.latDeg, lonDeg: data.site.lonDeg }, summary)
  const failures: ConstraintFailure[] = []
  if (objective && research.match === 'incompatible') failures.push({ code: 'research', message: research.reasons.join(' ') })
  failures.push(...constraintFailures(summary, settings))
  const dataBad = failures.some((f) => f.code === 'data')
  return { ...base, startUtc, metrics: dataBad ? null : metricsOf(summary), summary, feasible: failures.length === 0, failures, research }
}

interface RunState {
  started: number
  done: number
  planned: number
  stopped: SearchStatus | null
}

async function runJobs(jobs: Job[], settings: MissionSettings, objective: ResearchProfile | null | undefined, opts: SearchOptions, state: RunState, out: SearchCandidate[]): Promise<void> {
  const chunk = Math.max(1, opts.chunkSize ?? 24)
  state.planned += jobs.length
  for (let i = 0; i < jobs.length; i += chunk) {
    if (opts.signal?.aborted) {
      state.stopped = 'cancelled'
      return
    }
    if (opts.budgetMs !== undefined && Date.now() - state.started > opts.budgetMs) {
      state.stopped = 'partial'
      return
    }
    for (const job of jobs.slice(i, i + chunk)) out.push(runJob(job, settings, objective))
    state.done += Math.min(chunk, jobs.length - i)
    opts.onProgress?.(state.done, state.planned)
    await yieldNow()
  }
}

/** Unrefined map-cell finalists grouped by site (at most 10 per site, in result order). */
export function refineSuggestions(finalists: SearchCandidate[]): { siteId: string; cells: string[] }[] {
  const bySite = new Map<string, string[]>()
  for (const c of finalists) {
    if (c.precision !== 'cell') continue
    const m = /^(.+):(r\d+c\d+)$/.exec(c.siteId)
    if (!m) continue
    const list = bySite.get(m[1]) ?? []
    if (list.length < 10 && !list.includes(m[2])) list.push(m[2])
    bySite.set(m[1], list)
  }
  return [...bySite].map(([siteId, cells]) => ({ siteId, cells }))
}

function finish(kind: SearchResult['kind'], all: SearchCandidate[], state: RunState, sortBy: SearchMetric, opts: SearchOptions, info: Pick<SearchResult, 'searchedRange' | 'timeStep' | 'spatialCoverage' | 'objectiveId'>, notes: string[]): SearchResult {
  markPareto(all)
  const order = compareCandidates(sortBy)
  const feasible = all.filter((c) => c.feasible).sort(order)
  const failureCounts: Partial<Record<FailureCode, number>> = {}
  for (const c of all) for (const f of c.failures) failureCounts[f.code] = (failureCounts[f.code] ?? 0) + 1
  const rejected = all
    .filter((c) => !c.feasible)
    .sort((a, b) => a.failures.length - b.failures.length || order(a, b))
    .slice(0, opts.maxRejected ?? 10)
  const status: SearchStatus = state.stopped ?? 'complete'
  const out = [...notes]
  if (status !== 'complete') out.unshift(status === 'cancelled' ? 'Search cancelled: results cover only the candidates tested so far.' : 'Time budget reached: results cover only the candidates tested so far, not the whole range.')
  if (feasible.length === 0 && status === 'complete') {
    const reasons = (Object.entries(failureCounts) as [FailureCode, number][]).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${FAILURE_TEXT[code]} (${n} of ${all.length})`)
    out.push(`No tested option meets every condition. ${reasons.join('; ')}. The limits were not relaxed.`)
  }
  if (feasible.length > 0) out.push(`“Best” means best among the ${all.length} tested options for “${METRICS[sortBy].label.toLowerCase()}”, not a proven optimum.`)
  if (all.some((c) => c.precision === 'cell')) out.push('Map points use a 1° horizon: a regional screening estimate, less precise than the 0.1° catalogue horizon.')
  if (all.some((c) => c.precision === 'refined')) out.push('Some map points were revalidated with the 0.1° catalogue horizon (refined.json); they are still not catalogue sites.')
  const toRefine = refineSuggestions(feasible.filter((c) => c.pareto))
  for (const r of toRefine) out.push(`Screening finalists not yet revalidated: python -m preprocess.refine_cells --site ${r.siteId} --cells ${r.cells.join(' ')}`)
  if (info.objectiveId === null) out.push(`${RESEARCH_UNVERIFIED}: no research objective was chosen, so no option is claimed to keep the same research.`)
  else if (!all.some((c) => c.research.match === 'equivalent')) out.push(`${RESEARCH_UNVERIFIED} for any tested option (no sourced research profile matched).`)
  return {
    kind,
    status,
    ...info,
    sortBy,
    tested: all.length,
    feasible,
    pareto: feasible.filter((c) => c.pareto),
    rejected,
    failureCounts,
    best: status === 'complete' ? (feasible[0] ?? null) : null,
    refineSuggestions: toRefine,
    notes: out,
    elapsedMs: Date.now() - state.started,
  }
}

/** Plain names of the failure codes, for the UI. */
export const FAILURE_TEXT: Record<FailureCode, string> = {
  data: 'data missing or invalid',
  coverage: 'mission outside the computed period',
  research: 'research objective not supported',
  reserve: 'battery falls below the reserve',
  unmet: 'demand cannot be served',
  earthOutage: 'Earth out of view longer than allowed',
}

function checkSettings(settings: MissionSettings) {
  const issues = validateSettings(settings)
  if (issues.length > 0) throw new SettingsError(issues)
}

// ---------------------------------------------------------------------------------------------
// Dates for a place

export interface DateSearchInput {
  data: SiteData
  settings: MissionSettings
  /** First and last mission start to test (UTC). The time of day of `fromUtc` is kept by the coarse step. */
  fromUtc: string
  toUtc: string
  /** Coarse step, default one day. */
  coarseStepS?: number
  /** Refine around the coarse finalists: hourly within ±24 h, then every data step within ±1 h. Default true. */
  refine?: boolean
  /** Finalists refined at each stage. */
  finalists?: number
  sortBy?: SearchMetric
  precision?: Precision
  objective?: ResearchProfile | null
  profile?: ResearchProfile | null
}

function coverageOf(data: SiteData, settings: MissionSettings) {
  const e = data.ephemeris
  const t0 = Date.parse(e.startUtc)
  const lastStart = t0 + ((e.count - 1) * e.stepS - Math.round((settings.durationDays * 86400) / e.stepS) * e.stepS) * 1000
  return { t0, lastStart, stepMs: e.stepS * 1000, end: t0 + (e.count - 1) * e.stepS * 1000 }
}

export async function findDatesForPlace(input: DateSearchInput, opts: SearchOptions = {}): Promise<SearchResult> {
  const { data, settings } = input
  checkSettings(settings)
  const sortBy = input.sortBy ?? 'minSoc'
  const coarseS = input.coarseStepS ?? 86400
  const precision = input.precision ?? (data.site.id.includes(':') ? 'cell' : 'catalogue')
  const from = Date.parse(input.fromUtc)
  const to = Date.parse(input.toUtc)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new RangeError('The date range needs a start and an end after it.')
  if (!(coarseS > 0)) throw new RangeError('The date step must be positive.')
  const cov = coverageOf(data, settings)
  const state: RunState = { started: Date.now(), done: 0, planned: 0, stopped: null }
  const all: SearchCandidate[] = []
  const seen = new Set<string>()
  const job = (ms: number): Job | null => {
    const startUtc = iso(Math.round((ms - cov.t0) / cov.stepMs) * cov.stepMs + cov.t0)
    if (seen.has(startUtc)) return null
    seen.add(startUtc)
    return { siteId: data.site.id, startUtc, precision, data: () => data, profile: input.profile }
  }
  const jobsFor = (times: number[]) => times.map(job).filter((j): j is Job => j !== null)

  // Coarse: every `coarseS` from `fromUtc`, also the starts outside the data (they fail as `coverage`, not dropped).
  const coarse: number[] = []
  for (let t = from; t <= to; t += coarseS * 1000) coarse.push(t)
  await runJobs(jobsFor(coarse), settings, input.objective, opts, state, all)

  const refineS: number[] = []
  if ((input.refine ?? true) && !state.stopped) {
    const n = Math.max(1, input.finalists ?? 5)
    for (const [stepS, halfS] of [[3600, 86400], [data.ephemeris.stepS, 3600]] as const) {
      if (stepS >= coarseS || state.stopped) continue
      markPareto(all)
      const finalists = all.filter((c) => c.pareto).sort(compareCandidates(sortBy)).slice(0, n)
      if (finalists.length === 0) break
      refineS.push(stepS)
      const times: number[] = []
      for (const f of finalists) {
        const c = Date.parse(f.startUtc)
        for (let dt = -halfS; dt <= halfS; dt += stepS) {
          const t = c + dt * 1000
          if (t >= from && t <= to) times.push(t)
        }
      }
      await runJobs(jobsFor(times), settings, input.objective, opts, state, all)
    }
  }

  const notes: string[] = [`Place fixed: ${data.site.name} (${data.site.id}). Same hardware and ${settings.durationDays}-day mission for every start.`]
  if (from < cov.t0 || to > cov.lastStart) notes.push(`Data covers mission starts ${iso(cov.t0).slice(0, 16)} to ${iso(cov.lastStart).slice(0, 16)} UTC; starts outside are reported as outside the computed period, not shifted.`)
  return finish('dates', all, state, sortBy, opts, {
    searchedRange: { fromUtc: iso(from), toUtc: iso(to) },
    timeStep: { coarseS, refineS },
    spatialCoverage: { description: `One place: ${data.site.id}`, places: 1 },
    objectiveId: input.objective?.objectiveId ?? null,
  }, notes)
}

// ---------------------------------------------------------------------------------------------
// Places for a date

/** A place a search may test. `data` builds the engine input for the mission (may be a slice). */
export interface PlaceSource {
  siteId: string
  precision: Precision
  latDeg: number
  lonDeg: number
  data: (startUtc: string, settings: MissionSettings) => SiteData
  profile?: ResearchProfile | null
}

/** Catalogue sites as place sources (their own validated series). */
export function cataloguePlaces(sites: SiteData[]): PlaceSource[] {
  return sites.map((d) => ({ siteId: d.site.id, precision: 'catalogue' as const, latDeg: d.site.latDeg, lonDeg: d.site.lonDeg, data: () => d }))
}

export interface CellPlaceOptions {
  filter?: (row: number, col: number) => boolean
  /**
   * `extended.json` of the site: with it the Moon-fixed vectors come from A's shared cache
   * (`moonFixedSeries`, key = year.bin sha256 + centre observer + horizon resolution) and cells get
   * provenance; without it a per-object cache is used.
   */
  header?: ExtendedHeader
  /** `refined.json`: usable entries (same cells.bin, same observer) use their 0.1° horizon. */
  refined?: RefinedDoc | null
}

/**
 * Every map cell of a site as a place source. Only the mission slice of the year series is
 * re-projected per cell, never the whole year. `cells` must belong to `base`.
 */
export function cellPlaces(base: SiteData, year: SiteData['ephemeris'], cells: CellHorizons, opts: CellPlaceOptions | ((row: number, col: number) => boolean) = {}): PlaceSource[] {
  const o: CellPlaceOptions = typeof opts === 'function' ? { filter: opts } : opts
  const map = base.map
  if (!map) return []
  const { nx, ny } = map.grid
  if (cells.n !== nx * ny) throw new RangeError(`${base.site.id}: cells.bin has ${cells.n} cells, map.json ${nx * ny}.`)
  const centre = centreObserver(base.site)
  const header = o.header
  const series = header
    ? () => moonFixedSeries(year, centre, moonFixedKey({ dataHash: header.year.sha256, ...centre, horizonResolutionDeg: cells.azStepDeg }))
    : null
  const out: PlaceSource[] = []
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      if (o.filter && !o.filter(row, col)) continue
      const index = row * nx + col
      const siteId = `${base.site.id}:r${row}c${col}`
      const latDeg = map.latDeg[index]
      const lonDeg = map.lonDeg[index]
      const observer = { latDeg, lonDeg, eyeM: cells.eyeM[index] }
      const refined = header ? usableRefined(o.refined, header, `r${row}c${col}`, observer) : undefined
      out.push({
        siteId,
        precision: refined ? 'refined' : 'cell',
        latDeg,
        lonDeg,
        data: (startUtc, settings) => {
          const t0 = Date.parse(year.startUtc)
          const startIndex = Math.round((Date.parse(startUtc) - t0) / 1000 / year.stepS)
          const steps = Math.round((settings.durationDays * 86400) / year.stepS)
          if (!Number.isFinite(startIndex) || startIndex < 0 || startIndex + steps > year.count - 1) {
            throw new CoverageError(`The mission must lie within the computed period (${year.startUtc.slice(0, 16)} to ${iso(t0 + (year.count - 1) * year.stepS * 1000).slice(0, 16)} UTC).`)
          }
          const ephemeris = series ? projectWindow(series(), observer, startIndex, startIndex + steps + 1) : cellEphemerisSlice(year, centre, observer, startIndex, steps + 1)
          const horizon = refined
            ? { azStepDeg: refined.azStepDeg, count: refined.count, elevDeg: refined.elevDeg, distanceM: refined.distanceM, warnings: [...refined.warnings] }
            : cellHorizon(cells, index)
          const provenance: Provenance | undefined = header
            ? {
                latDeg, lonDeg, observerHeightM: base.site.observerHeightM, eyeM: observer.eyeM, ephemerisSource: year.source, dataHash: header.year.sha256,
                ...(refined
                  ? { horizonResolutionDeg: refined.azStepDeg, horizonSource: 'refined-cell' as const, precision: 'catalogue' as const, coverageWarnings: [...refined.warnings] }
                  : { horizonResolutionDeg: cells.azStepDeg, horizonSource: 'map-cell' as const, precision: 'regional screening estimate' as const, coverageWarnings: [...(map.warnings ?? [])] }),
              }
            : undefined
          return {
            ...base,
            site: { ...base.site, id: siteId, name: `${base.site.name} — map point`, latDeg, lonDeg, label: refined ? REFINED_CELL_LABEL : CELL_LABEL, derivedFrom: base.site.id, warnings: [] },
            horizon,
            ephemeris: { ...ephemeris, siteId },
            season: undefined,
            provenance,
          }
        },
      })
    }
  }
  return out
}

export { arcDistanceM }

export interface PlaceSearchInput {
  places: PlaceSource[]
  settings: MissionSettings
  startUtc: string
  sortBy?: SearchMetric
  objective?: ResearchProfile | null
  /** Words for `spatialCoverage`, e.g. "Catalogue sites + ±3 km map of Site01". */
  coverage?: string
  /** For distance-limited searches. */
  origin?: { latDeg: number; lonDeg: number }
}

function placeJobs(input: PlaceSearchInput): Job[] {
  return input.places.map((p) => ({
    siteId: p.siteId,
    startUtc: input.startUtc,
    precision: p.precision,
    distanceM: input.origin ? arcDistanceM(input.origin.latDeg, input.origin.lonDeg, p.latDeg, p.lonDeg) : undefined,
    data: () => p.data(input.startUtc, input.settings),
    profile: p.profile,
  }))
}

export async function findPlacesForDate(input: PlaceSearchInput, opts: SearchOptions = {}): Promise<SearchResult> {
  checkSettings(input.settings)
  const sortBy = input.sortBy ?? 'minSoc'
  const t = Date.parse(input.startUtc)
  if (!Number.isFinite(t)) throw new RangeError('The mission start needs a valid UTC time.')
  const state: RunState = { started: Date.now(), done: 0, planned: 0, stopped: null }
  const all: SearchCandidate[] = []
  await runJobs(placeJobs(input), input.settings, input.objective, opts, state, all)
  const cells = input.places.filter((p) => p.precision !== 'catalogue').length
  const description = input.coverage ?? `${input.places.length - cells} catalogue site(s) and ${cells} map point(s)`
  return finish('places', all, state, sortBy, opts, {
    searchedRange: { fromUtc: iso(t), toUtc: iso(t) },
    timeStep: { coarseS: null, refineS: [] },
    spatialCoverage: { description, places: input.places.length },
    objectiveId: input.objective?.objectiveId ?? null,
  }, [`Start fixed: ${iso(t).slice(0, 16)} UTC. Same hardware and ${input.settings.durationDays}-day mission at every place. Only the listed places were searched, not the whole Moon.`])
}

// ---------------------------------------------------------------------------------------------
// Nearby places that keep the research

export interface NearbySearchInput extends Omit<PlaceSearchInput, 'origin'> {
  origin: { siteId: string; latDeg: number; lonDeg: number }
  /** Accepted distance from the first place, shown to the user. */
  maxDistanceM: number
}

export interface NearbySearchResult extends SearchResult {
  maxDistanceM: number
  /** Feasible and research `equivalent`: may be offered as "same research nearby". */
  equivalent: SearchCandidate[]
  /** Feasible but research `unknown`: must be shown apart, labelled "Scientific suitability could not be verified". */
  unverified: SearchCandidate[]
}

/**
 * Places within `maxDistanceM` of the first place, same start, hardware and duration. Closeness or
 * better energy alone never makes a place equivalent: only `compareResearch` = `equivalent` does.
 */
export async function findNearbyEquivalentPlaces(input: NearbySearchInput, opts: SearchOptions = {}): Promise<NearbySearchResult> {
  if (!(input.maxDistanceM >= 0)) throw new RangeError('The accepted distance must be zero or more.')
  const near = input.places.filter((p) => p.siteId !== input.origin.siteId && arcDistanceM(input.origin.latDeg, input.origin.lonDeg, p.latDeg, p.lonDeg) <= input.maxDistanceM)
  const r = await findPlacesForDate({ ...input, places: near, coverage: input.coverage ?? `${near.length} place(s) within ${(input.maxDistanceM / 1000).toFixed(1)} km of ${input.origin.siteId}` }, opts)
  const equivalent = r.feasible.filter((c) => c.research.match === 'equivalent')
  const unverified = r.feasible.filter((c) => c.research.match === 'unknown')
  const notes = [...r.notes, 'Being close is not enough: a nearby option keeps the research only when its sourced profile matches the target, measurement, instruments and conditions.']
  return { ...r, kind: 'nearby', best: r.status === 'complete' ? (equivalent[0] ?? null) : null, maxDistanceM: input.maxDistanceM, equivalent, unverified, notes }
}

// ---------------------------------------------------------------------------------------------
// Stale results

/**
 * Keeps only the newest search: starting one aborts the previous, and a superseded search
 * resolves to `null` so an old answer can never overwrite the screen for new settings.
 */
export function latestSearch() {
  let current: AbortController | null = null
  let id = 0
  return async function run<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    current?.abort()
    const controller = new AbortController()
    current = controller
    const mine = ++id
    const result = await start(controller.signal)
    return mine === id ? result : null
  }
}
