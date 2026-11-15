/**
 * Better start dates at the same place, for one research type.
 *
 * NASA's challenge asks for both kinds of fallback when a schedule slips: another site in the
 * same region (research.ts `alternativesFor`) or another date at the same site (this file).
 *
 * The Sun / Earth visibility windows are computed once over the whole pre-computed series
 * (JPL Horizons positions against the LOLA terrain horizon, the engine's own rule: centre above
 * the horizon). Every candidate start (every 6 hours) then clips those windows to the mission,
 * which gives exactly the windows `evaluateScenario` would find for that start. Consecutive
 * starts that fit a research type form a "start window": any start inside it works.
 * Pure functions: same inputs, same answers.
 */
import type { EphemerisDoc, HorizonDoc } from '../data/contract.ts'
import type { Fit, ResearchMetrics, ResearchType } from './research.ts'
import { intersectWindows, marginSeries, windowsFromMargins } from './visibility.ts'
import type { VisibilityWindow } from './visibility.ts'

/** Spacing of the candidate starts. */
export const SCAN_STEP_S = 6 * 3600

export interface DateCandidate {
  startUtc: string
  /** The place's metrics with the window-based values for this start. */
  metrics: ResearchMetrics
}

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

/** Longest and total visible time of sorted windows inside [fromS, toS). `first` skips windows that ended earlier. */
function clip(windows: VisibilityWindow[], fromS: number, toS: number, first: { i: number }): { longest: number; total: number } {
  while (first.i < windows.length && windows[first.i].endS <= fromS) first.i++
  let longest = 0
  let total = 0
  for (let i = first.i; i < windows.length && windows[i].startS < toS; i++) {
    const d = Math.min(windows[i].endS, toS) - Math.max(windows[i].startS, fromS)
    if (d > 0) {
      total += d
      if (d > longest) longest = d
    }
  }
  return { longest, total }
}

/**
 * Metrics for every start (every `stepS`) whose mission of `durationS` fits in the series.
 * `base` supplies the place-only values (PSR distance, slope, full-year Earth share).
 */
export function scanStartDates(ephemeris: EphemerisDoc, horizon: Pick<HorizonDoc, 'azStepDeg' | 'elevDeg'>, base: ResearchMetrics, durationS: number, stepS = SCAN_STEP_S): DateCandidate[] {
  const n = ephemeris.count
  const sun = windowsFromMargins(marginSeries(ephemeris.sun, horizon, 0, n), ephemeris.stepS)
  const earth = windowsFromMargins(marginSeries(ephemeris.earth, horizon, 0, n), ephemeris.stepS)
  const both = intersectWindows(sun, earth)
  const steps = Math.round(durationS / ephemeris.stepS)
  const stride = Math.max(1, Math.round(stepS / ephemeris.stepS))
  const t0 = Date.parse(ephemeris.startUtc)
  const firsts = { sun: { i: 0 }, earth: { i: 0 }, both: { i: 0 } }
  const out: DateCandidate[] = []
  if (steps < 1) return out
  const dur = steps * ephemeris.stepS
  for (let s = 0; s + steps <= n - 1; s += stride) {
    const fromS = s * ephemeris.stepS
    const toS = fromS + dur
    const sc = clip(sun, fromS, toS, firsts.sun)
    const ec = clip(earth, fromS, toS, firsts.earth)
    const bc = clip(both, fromS, toS, firsts.both)
    out.push({
      startUtc: iso(t0 + fromS * 1000),
      metrics: {
        ...base,
        durationS: dur,
        sunFraction: sc.total / dur,
        earthFraction: ec.total / dur,
        bothFraction: bc.total / dur,
        longestSunS: sc.longest,
        longestEarthS: ec.longest,
        longestBothS: bc.longest,
      },
    })
  }
  return out
}

/** Consecutive candidate starts that all reach the same fit. */
export interface StartWindow {
  firstUtc: string
  lastUtc: string
  fit: Fit
  /** The start in the window that measures best for the research type. */
  best: DateCandidate
  value: string
  /** Where the window lies relative to the chosen start; `best` is the best window of the period. */
  tags: ('earlier' | 'later' | 'best')[]
}

export interface DateAdvice {
  /** Best fit any start reaches in the period, or null when no start fits. */
  fit: Fit | null
  /** The window the chosen start already lies in, when it reaches that fit. */
  current: StartWindow | null
  /** Up to three other windows: the nearest earlier, the nearest later and the best one, by date. */
  options: StartWindow[]
  /** Number of windows with that fit in the period. */
  windowCount: number
  fromUtc: string | null
  toUtc: string | null
}

/**
 * Start windows for one research type at one place. Only the best fit reached in the period
 * counts (a "possible" window is not offered when "good" ones exist).
 */
export function betterDatesFor(type: ResearchType, candidates: DateCandidate[], chosenStartUtc: string, chosenMetrics: ResearchMetrics, stepS = SCAN_STEP_S): DateAdvice {
  const assessed = candidates.map((c) => ({ c, ...type.assess(c.metrics) }))
  const fit: Fit | null = assessed.some((a) => a.fit === 'strong') ? 'strong' : assessed.some((a) => a.fit === 'possible') ? 'possible' : null
  const empty = { current: null, options: [], windowCount: 0, fromUtc: candidates[0]?.startUtc ?? null, toUtc: candidates.at(-1)?.startUtc ?? null }
  if (!fit) return { fit, ...empty }

  const runs: StartWindow[] = []
  let open: typeof assessed = []
  const close = () => {
    if (!open.length) return
    const best = open.reduce((b, a) => (type.score(a.c.metrics) > type.score(b.c.metrics) ? a : b))
    runs.push({ firstUtc: open[0].c.startUtc, lastUtc: open.at(-1)!.c.startUtc, fit, best: best.c, value: best.value, tags: [] })
    open = []
  }
  for (const a of assessed) {
    if (a.fit === fit) open.push(a)
    else close()
  }
  close()

  const chosen = Date.parse(chosenStartUtc)
  const inside = (w: StartWindow) => Date.parse(w.firstUtc) <= chosen && chosen < Date.parse(w.lastUtc) + stepS * 1000
  const current = type.assess(chosenMetrics).fit === fit ? runs.find(inside) ?? null : null
  const others = runs.filter((w) => w !== current)
  const earlier = others.filter((w) => Date.parse(w.lastUtc) < chosen).at(-1)
  const later = others.find((w) => Date.parse(w.firstUtc) > chosen)
  const best = others.reduce<StartWindow | undefined>((b, w) => (!b || type.score(w.best.metrics) > type.score(b.best.metrics) ? w : b), undefined)
  earlier?.tags.push('earlier')
  later?.tags.push('later')
  best?.tags.push('best')
  const options = [...new Set([earlier, later, best].filter((w): w is StartWindow => !!w))]
    .sort((a, b) => Date.parse(a.firstUtc) - Date.parse(b.firstUtc))
  return { fit, current, options, windowCount: runs.length, fromUtc: empty.fromUtc, toUtc: empty.toUtc }
}
