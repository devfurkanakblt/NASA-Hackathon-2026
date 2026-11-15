import { evaluateScenario } from './evaluate.ts'
import { constraintFailures, compareCandidates, findDatesForPlace, metricsOf, type DateSearchInput, type SearchOptions, type SearchResult } from './search.ts'

/** Prefix feasibility is monotone: extending a mission cannot undo a reserve,
 * unmet-demand or maximum-outage violation. Search whole-day durations per start. */
export async function findMissionForPlace(input: DateSearchInput & { maxDurationDays: number }, opts: SearchOptions = {}): Promise<SearchResult> {
  if (!Number.isInteger(input.maxDurationDays) || input.maxDurationDays < 1) throw new RangeError('Maximum duration must be a positive whole number of days.')
  if (input.objective) throw new RangeError('Duration planning supports hardware constraints only.')
  const started = Date.now()
  const result = await findDatesForPlace({ ...input, settings: { ...input.settings, durationDays: 1 }, refine: false }, { ...opts, maxRejected: Number.MAX_SAFE_INTEGER })
  const covered = [...result.feasible, ...result.rejected].filter(c => c.summary !== null)
  result.durationScreening = {
    minimumDays: 1,
    startsTested: result.tested,
    coveredStarts: covered.length,
    earthHiddenAtEveryCoveredStart: covered.length > 0 && covered.every(c => c.summary!.earthVisibleFraction === 0),
  }
  // Rejections describe the minimum-duration screening, not a failed 90-day mission.
  result.rejected = result.rejected.slice(0, opts.maxRejected ?? 10).map(c => ({ ...c, durationDays: 1, pareto: false }))
  const seeds = result.feasible
  result.feasible = []
  result.best = null
  const end = Date.parse(input.data.ephemeris.startUtc) + (input.data.ephemeris.count - 1) * input.data.ephemeris.stepS * 1000
  for (let i = 0; i < seeds.length; i++) {
    if (opts.signal?.aborted || (opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs)) {
      result.status = opts.signal?.aborted ? 'cancelled' : 'partial'
      break
    }
    const candidate = seeds[i]
    let low = 1
    let high = Math.min(input.maxDurationDays, Math.floor((end - Date.parse(candidate.startUtc)) / 86400000))
    while (low < high) {
      const days = Math.ceil((low + high) / 2)
      const settings = { ...input.settings, durationDays: days }
      const summary = evaluateScenario(input.data, candidate.startUtc, settings).summary
      result.tested++
      if (constraintFailures(summary, settings).length === 0) low = days
      else high = days - 1
    }
    const summary = evaluateScenario(input.data, candidate.startUtc, { ...input.settings, durationDays: low }).summary
    result.feasible.push({ ...candidate, durationDays: low, summary, metrics: metricsOf(summary), pareto: false })
    opts.onProgress?.(i + 1, seeds.length)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  result.feasible.sort((a, b) => b.durationDays! - a.durationDays! || compareCandidates(result.sortBy)(a, b))
  result.pareto = []
  result.best = result.status === 'complete' ? result.feasible[0] ?? null : null
  result.notes = [
    `Longest feasible whole-day mission, up to ${input.maxDurationDays} days; ties use the selected metric.`,
    `Starts tested every ${(input.coarseStepS ?? 86400) / 3600} hours within the requested range. This is a sampled search, not a proven continuous optimum.`,
    `Source coverage: ${input.data.ephemeris.startUtc} to ${new Date(end).toISOString()}. The entire mission must fit this period.`,
    'The tie breaker only orders feasible missions with equal duration. It cannot make a rejected mission feasible.',
    'Battery reserve, served demand and Earth outage limits are required for the entire mission. Research equivalence and landing safety are not assessed.',
    ...(result.status !== 'complete' ? ['Search incomplete; no final recommendation is available.'] : []),
  ]
  if (result.status === 'complete' && !result.best && result.durationScreening.earthHiddenAtEveryCoveredStart) {
    result.notes.unshift(`Earth stays hidden throughout every tested 1-day mission. Each has a 24-hour direct-to-Earth outage; the allowed maximum is ${input.settings.maxEarthOutageH} hours. Relay communication is not modelled. Consider an Earth-facing location, or change the outage limit only if the mission can operate without direct Earth contact.`)
  }
  result.elapsedMs = Date.now() - started
  return result
}
