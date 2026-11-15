/**
 * Research-equivalence rule shared by the searches (A→D draft contract, docs/ekip-notlari.md).
 * Two places support "the same research" only when the target, the footprint, the
 * instruments / measurement and the light / view conditions all match with sourced evidence.
 * Distance, energy or a shared generic label is never evidence. Missing metadata gives
 * `unknown`, and `unknown` is never treated as `equivalent`.
 *
 * No research profiles are shipped yet (A's data product): every candidate is `unknown` until
 * they are, and the UI must say "Scientific suitability could not be verified".
 */
import type { ScenarioSummary } from './evaluate.ts'

export type ResearchMatch = 'equivalent' | 'incompatible' | 'unknown'

export interface ResearchEvidence {
  source: string
  /** Page, section or figure. */
  locator: string
}

/** One sourced research objective at one place (catalogue site or map cell). */
export interface ResearchProfile {
  objectiveId: string
  /** Short public name, e.g. "Study a permanently shadowed surface". */
  name: string
  /** Target material / geological unit, or environment (e.g. "permanently shadowed regolith"). */
  target: string
  /** Where the target is: circle on the surface. The place must lie inside it. */
  footprint: { latDeg: number; lonDeg: number; radiusM: number }
  measurement: string
  instruments: string[]
  /** Light / view conditions the measurement needs over the mission. */
  conditions: {
    /** Minimum share of the mission with the Sun up, 0–1 (e.g. for a solar-powered instrument). */
    minSunFraction?: number
    /** Maximum share with the Sun up, 0–1 (e.g. 0 for a shadowed-environment measurement). */
    maxSunFraction?: number
    /** Minimum share with Earth in view, 0–1 (direct-to-Earth data return). */
    minEarthFraction?: number
  }
  /** `verified`: the target is confirmed at this place by the evidence; others are not enough. */
  status: 'verified' | 'potential' | 'insufficient'
  evidence: ResearchEvidence[]
}

export interface ResearchDecision {
  match: ResearchMatch
  /** Plain English reasons, for the "Why?" details. */
  reasons: string[]
}

const UNVERIFIED = 'Scientific suitability could not be verified'

function complete(p: ResearchProfile | null | undefined): p is ResearchProfile {
  return (
    !!p &&
    !!p.objectiveId &&
    !!p.target &&
    !!p.measurement &&
    Array.isArray(p.instruments) &&
    p.instruments.length > 0 &&
    !!p.footprint &&
    Number.isFinite(p.footprint.latDeg) &&
    Number.isFinite(p.footprint.lonDeg) &&
    Number.isFinite(p.footprint.radiusM) &&
    Array.isArray(p.evidence) &&
    p.evidence.length > 0
  )
}

const MOON_RADIUS_M = 1737400

/** Great-circle distance on the 1737.4 km sphere, m. */
export function arcDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Light / view conditions of a profile against one mission result. Time-dependent: a new start
 * date needs a new check. Returns the failed conditions (empty when all hold).
 */
export function conditionFailures(profile: ResearchProfile, summary: Pick<ScenarioSummary, 'sunVisibleFraction' | 'earthVisibleFraction'>): string[] {
  const c = profile.conditions ?? {}
  const out: string[] = []
  const pct = (v: number) => `${(100 * v).toFixed(1)} %`
  if (c.minSunFraction !== undefined && !(summary.sunVisibleFraction >= c.minSunFraction)) out.push(`Sun in view ${pct(summary.sunVisibleFraction)}; the measurement needs at least ${pct(c.minSunFraction)}.`)
  if (c.maxSunFraction !== undefined && !(summary.sunVisibleFraction <= c.maxSunFraction)) out.push(`Sun in view ${pct(summary.sunVisibleFraction)}; the measurement needs at most ${pct(c.maxSunFraction)}.`)
  if (c.minEarthFraction !== undefined && !(summary.earthVisibleFraction >= c.minEarthFraction)) out.push(`Earth in view ${pct(summary.earthVisibleFraction)}; the measurement needs at least ${pct(c.minEarthFraction)}.`)
  return out
}

/**
 * Does `candidate` (profile at a candidate place, located at `where`) support the research
 * `objective` the user chose at the first place? `summary` is the candidate's mission result for
 * the time-dependent conditions; without it the conditions are not checked and the answer cannot
 * be `equivalent`.
 */
export function compareResearch(
  objective: ResearchProfile | null | undefined,
  candidate: ResearchProfile | null | undefined,
  where: { latDeg: number; lonDeg: number },
  summary?: Pick<ScenarioSummary, 'sunVisibleFraction' | 'earthVisibleFraction'>,
): ResearchDecision {
  if (!objective) return { match: 'unknown', reasons: ['No research objective chosen.', UNVERIFIED + '.'] }
  if (!complete(objective)) return { match: 'unknown', reasons: ['The chosen objective has missing research metadata.', UNVERIFIED + '.'] }
  if (!complete(candidate)) return { match: 'unknown', reasons: ['No sourced research profile for this place.', UNVERIFIED + '.'] }
  if (candidate.objectiveId !== objective.objectiveId) return { match: 'incompatible', reasons: [`This place supports “${candidate.name}”, not “${objective.name}”.`] }
  if (candidate.target !== objective.target) return { match: 'incompatible', reasons: [`Different target: ${candidate.target} instead of ${objective.target}.`] }
  if (candidate.measurement !== objective.measurement) return { match: 'incompatible', reasons: [`Different measurement: ${candidate.measurement} instead of ${objective.measurement}.`] }
  const missing = objective.instruments.filter((i) => !candidate.instruments.includes(i))
  if (missing.length > 0) return { match: 'incompatible', reasons: [`Instruments not supported here: ${missing.join(', ')}.`] }
  const d = arcDistanceM(where.latDeg, where.lonDeg, candidate.footprint.latDeg, candidate.footprint.lonDeg)
  if (d > candidate.footprint.radiusM) return { match: 'incompatible', reasons: [`The place is ${(d / 1000).toFixed(2)} km from the target, outside its ${(candidate.footprint.radiusM / 1000).toFixed(2)} km footprint.`] }
  if (candidate.status !== 'verified') return { match: 'unknown', reasons: [`Evidence for the target here is “${candidate.status}”, not verified.`, UNVERIFIED + '.'] }
  if (!summary) return { match: 'unknown', reasons: ['Light and Earth-view conditions not checked for this date.', UNVERIFIED + '.'] }
  const failed = conditionFailures(objective, summary)
  if (failed.length > 0) return { match: 'incompatible', reasons: failed }
  return {
    match: 'equivalent',
    reasons: [`Same target (${objective.target}), measurement and instruments; inside the target footprint; light and Earth-view conditions hold for this mission.`, ...candidate.evidence.map((e) => `Source: ${e.source}, ${e.locator}.`)],
  }
}

export { UNVERIFIED as RESEARCH_UNVERIFIED }
