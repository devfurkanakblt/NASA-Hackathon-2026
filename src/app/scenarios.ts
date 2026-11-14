/**
 * Scenario list and comparison logic of the app, kept out of the components so it can be tested
 * on the real data. Every number comes from the engine (`src/sim/evaluate.ts`); this file only
 * picks defaults, keeps each scenario's error with that scenario and words the comparison.
 */
import type { SiteData, SiteEntry } from '../data/contract.ts'
import { MAX_SCENARIOS, evaluateScenario } from '../sim/evaluate.ts'
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { errorMessage, fmtDuration, fmtHours, shiftUtc } from './format.ts'

export interface Scenario {
  key: string
  siteId: string
  startUtc: string
}

export interface ScenarioOutcome {
  scenario: Scenario
  /** A, B, C — the scenario's name on every chart and in the comparison. */
  letter: string
  result: ScenarioResult | null
  /** Error, or the loading message while the scenario's per-site files arrive. */
  error: string | null
  /** True while the scenario waits for its one-year / map-point files (shown muted, not as an error). */
  loading: boolean
  /** The data the scenario ran on (a map point or the one-year series when needed). */
  data: SiteData | null
}

/** Turns a scenario's site id and start into the data to run on (see extendedSites.resolveSiteData). */
export type SiteResolver = (siteId: string, startUtc: string) => { data: SiteData } | { loading: string } | { error: string }

export type EvaluatedOutcome = ScenarioOutcome & { result: ScenarioResult }

/** Default mission start in the plan. */
export const DEFAULT_START_UTC = '2026-11-15T00:00:00Z'
export const LETTERS = ['A', 'B', 'C'] as const

let nextKey = 1
export const newKey = () => `s${nextKey++}`

/**
 * The comparison of the demo story (slide 5): the Site04 catalogue point, the ridge 1.9 km away,
 * and the ridge three days later. Falls back to the first sites when those are missing.
 */
export function defaultScenarios(siteIds: string[]): Scenario[] {
  if (siteIds.length === 0) return []
  const pick = (id: string, fallback: number) => (siteIds.includes(id) ? id : siteIds[Math.min(fallback, siteIds.length - 1)])
  return [
    { key: newKey(), siteId: pick('Site04', 0), startUtc: DEFAULT_START_UTC },
    { key: newKey(), siteId: pick('Site04R', 1), startUtc: DEFAULT_START_UTC },
    { key: newKey(), siteId: pick('Site04R', 1), startUtc: shiftUtc(DEFAULT_START_UTC, 72) },
  ]
}

/** Evaluates every scenario with the same settings; an error stays with its own scenario. */
export function evaluateAll(scenarios: Scenario[], settings: MissionSettings, resolve: SiteResolver): ScenarioOutcome[] {
  return scenarios.slice(0, MAX_SCENARIOS).map((scenario, i) => {
    const letter = LETTERS[i]
    const r = resolve(scenario.siteId, scenario.startUtc)
    if ('loading' in r) return { scenario, letter, result: null, error: r.loading, loading: true, data: null }
    if ('error' in r) return { scenario, letter, result: null, error: r.error, loading: false, data: null }
    try {
      return { scenario, letter, result: evaluateScenario(r.data, scenario.startUtc, settings), error: null, loading: false, data: r.data }
    } catch (e) {
      return { scenario, letter, result: null, error: errorMessage(e), loading: false, data: r.data }
    }
  })
}

export const isEvaluated = (o: ScenarioOutcome): o is EvaluatedOutcome => o.result !== null

/** "Site04R — Shackleton Rim (ridge point)" plus the derived / contrast tag. */
export function siteTitle(site: SiteEntry): string {
  const tag = site.derivedFrom ? ` (derived point near ${site.derivedFrom})` : site.category === 'contrast' ? ' (contrast point)' : ''
  return `${site.id} — ${site.name}${tag}`
}

const list = (letters: string[]) => (letters.length <= 1 ? letters.join('') : `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`)

/**
 * Plain-language answer to the planner's question: which scenarios keep the battery reserve and
 * which has the shortest Earth outage. No weights, no single score.
 */
export function comparisonSentences(outcomes: ScenarioOutcome[], settings: MissionSettings): string[] {
  const ok = outcomes.filter(isEvaluated)
  if (ok.length === 0) return []
  const sentences: string[] = []
  const reservePct = `${Math.round(settings.reserveFraction * 100)} %`
  const keep = ok.filter((o) => o.result.summary.keepsBatteryReserve).map((o) => o.letter)
  const lose = ok.filter((o) => !o.result.summary.keepsBatteryReserve).map((o) => o.letter)
  if (lose.length === 0) sentences.push(ok.length === 1 ? `${keep[0]} keeps the battery above its ${reservePct} reserve.` : `Every scenario keeps the battery above its ${reservePct} reserve.`)
  else if (keep.length === 0) sentences.push(ok.length === 1 ? `${lose[0]} drops below its ${reservePct} battery reserve.` : `No scenario keeps the battery above its ${reservePct} reserve.`)
  else sentences.push(`${list(keep)} ${keep.length === 1 ? 'keeps' : 'keep'} the battery above its ${reservePct} reserve; ${list(lose)} ${lose.length === 1 ? 'does' : 'do'} not.`)

  if (ok.length > 1) {
    const shortest = Math.min(...ok.map((o) => o.result.summary.longestEarthOutageS))
    const best = ok.filter((o) => o.result.summary.longestEarthOutageS === shortest).map((o) => o.letter)
    sentences.push(`Shortest longest Earth outage: ${list(best)} (${shortest === 0 ? 'Earth in view the whole mission' : fmtHours(shortest)}).`)
  }
  const within = ok.filter((o) => o.result.summary.earthOutageWithinLimit).map((o) => o.letter)
  const limit = fmtDuration(settings.maxEarthOutageH * 3600)
  if (within.length === 0) sentences.push(ok.length === 1 ? `${ok[0].letter} does not meet the accepted Earth outage of ${limit}.` : `No scenario meets the accepted Earth outage of ${limit}.`)
  else if (within.length === ok.length) sentences.push(ok.length === 1 ? `${within[0]} meets the accepted Earth outage of ${limit}.` : `Every scenario meets the accepted Earth outage of ${limit}.`)
  else sentences.push(`Only ${list(within)} ${within.length === 1 ? 'meets' : 'meet'} the accepted Earth outage of ${limit}.`)
  return sentences
}
