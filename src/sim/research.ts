/**
 * Research types a place suits, and the best alternative places for the same research.
 *
 * Each research type is one of NASA's own landing-region criteria (or a NASA-described use of
 * a location), turned into a measurement the app already makes from NASA data:
 *   - distance to the nearest mapped permanently shadowed region (NASA Moon Trek PSR layer),
 *   - the longest continuous sunlit / Earth-visible window in the mission (JPL Horizons + LOLA
 *     terrain horizon, the engine's own visibility windows),
 *   - Earth never above the terrain horizon (far-side radio shielding).
 * Thresholds marked "app assumption" are ours, not NASA requirements, and are shown as such.
 * Pure functions: same inputs, same answers.
 */
import type { Psr, SiteData } from '../data/contract.ts'
import type { ScenarioResult, ScenarioSummary } from './evaluate.ts'
import type { VisibilityWindow } from './visibility.ts'
import sources from './researchSources.json'

export type { Psr }

export interface ResearchMetrics {
  siteId: string
  latDeg: number
  lonDeg: number
  durationS: number
  sunFraction: number
  earthFraction: number
  bothFraction: number
  longestSunS: number
  longestEarthS: number
  longestBothS: number
  /** Distance to the nearest mapped PSR edge (equal-area circle); null when no PSR list applies. */
  psrEdgeKm: number | null
  psrName: string | null
  /** Slope at the place from the ±3 km map, when the place lies on it. */
  slopeDeg: number | null
  /** Earth visible share over the full year (season.json), when available. */
  earthYearPct: number | null
  /** `contrast` for the educational comparison points outside the south polar region. */
  region: 'polar' | 'contrast'
}

export type Fit = 'strong' | 'possible' | 'no'

export interface ResearchType {
  id: 'ice' | 'stay' | 'comms' | 'crew' | 'radio'
  title: string
  /** What NASA says, in one sentence. */
  basis: string
  source: { label: string; url: string }
  /** How the app measures it, including any app assumption. */
  rule: string
  assess: (m: ResearchMetrics) => { fit: Fit; value: string }
  /** Higher is better; used to rank alternatives that fit. */
  score: (m: ResearchMetrics) => number
  /** True when the fit changes with the start date (Sun / Earth windows), so other dates are worth listing. */
  dependsOnDate: boolean
}

export const MOON_RADIUS_KM = 1737.4
const DAY_S = 86400
/** Planned Artemis III surface stay quoted by NASA (6.5 days). */
export const STAY_S = 6.5 * DAY_S
/** App assumptions for reaching a PSR: on foot, and with a rover. */
export const WALK_KM = 2
export const ROVER_KM = 10
/** App assumption: steeper than this is not offered as a landing alternative. */
export const MAX_ALTERNATIVE_SLOPE_DEG = 10

const NASA_2022 = sources.nasa2022
const NASA_LCRT = sources.lcrt

const days = (s: number) => `${(s / DAY_S).toFixed(1)} d`
const pct = (f: number) => `${Math.round(f * 100)} %`

export const RESEARCH_TYPES: ResearchType[] = [
  {
    id: 'ice',
    title: 'Water-ice sampling in a permanently shadowed region',
    basis: 'NASA chose the Artemis III regions so crew can walk from the lander to a permanently shadowed region (PSR), to sample the water ice confirmed at the south pole.',
    source: NASA_2022,
    rule: `Distance to the nearest mapped PSR edge (NASA Moon Trek, PSRs of 10 km² or more). App assumption: up to ${WALK_KM} km on foot, up to ${ROVER_KM} km with a rover.`,
    assess: (m) => m.psrEdgeKm === null ? { fit: 'no', value: 'no mapped PSR nearby' }
      : { fit: m.psrEdgeKm <= WALK_KM ? 'strong' : m.psrEdgeKm <= ROVER_KM ? 'possible' : 'no',
          value: `${m.psrEdgeKm < 0.05 ? 'at the' : `${m.psrEdgeKm.toFixed(1)} km to the`} edge of a PSR${m.psrName ? ` (${m.psrName})` : ''}` },
    score: (m) => (m.psrEdgeKm === null ? -Infinity : -m.psrEdgeKm),
    dependsOnDate: false,
  },
  {
    id: 'stay',
    title: 'Long solar-powered stay',
    basis: 'NASA requires sites with continuous sunlight for 6.5 days, the planned surface stay: sunlight is the power source and limits temperature swings.',
    source: NASA_2022,
    rule: 'Longest continuous sunlit window in this mission (Sun centre above the terrain horizon). Strong: at least 6.5 days.',
    assess: (m) => ({ fit: m.longestSunS >= STAY_S ? 'strong' : m.longestSunS >= STAY_S / 2 ? 'possible' : 'no',
      value: `longest sunlit stretch ${days(m.longestSunS)}, Sun in view ${pct(m.sunFraction)} of the time` }),
    score: (m) => m.longestSunS + m.sunFraction,
    dependsOnDate: true,
  },
  {
    id: 'comms',
    title: 'Direct-to-Earth communication',
    basis: 'NASA weighed ease of communications with Earth when it chose the Artemis III landing regions.',
    source: NASA_2022,
    rule: 'Longest continuous window with Earth above the terrain horizon. Strong: at least 6.5 days; possible: Earth in view at least half the time.',
    assess: (m) => ({ fit: m.longestEarthS >= STAY_S ? 'strong' : m.earthFraction >= 0.5 ? 'possible' : 'no',
      value: `longest Earth contact ${days(m.longestEarthS)}, Earth in view ${pct(m.earthFraction)} of the time` }),
    score: (m) => m.longestEarthS + m.earthFraction,
    dependsOnDate: true,
  },
  {
    id: 'crew',
    title: 'Crewed operations with sunlight and Earth contact together',
    basis: 'The two NASA criteria above at the same time: power from sunlight and direct contact with Earth.',
    source: NASA_2022,
    rule: 'Longest continuous window with both the Sun and Earth in view. Strong: at least 6.5 days; possible: at least 3.25 days.',
    assess: (m) => ({ fit: m.longestBothS >= STAY_S ? 'strong' : m.longestBothS >= STAY_S / 2 ? 'possible' : 'no',
      value: `longest Sun + Earth stretch ${days(m.longestBothS)}, both in view ${pct(m.bothFraction)} of the time` }),
    score: (m) => m.longestBothS + m.bothFraction,
    dependsOnDate: true,
  },
  {
    id: 'radio',
    title: 'Radio astronomy shielded from Earth',
    basis: 'NASA describes the far side as a place where the Moon shields a radio telescope from Earth’s radio emissions.',
    source: NASA_LCRT,
    rule: 'Earth never above the terrain horizon over a full year (1 Nov 2026 – 1 Nov 2027). Possible: no full-year data, but Earth stays hidden for the whole mission.',
    assess: (m) => m.earthYearPct !== null
      ? { fit: m.earthYearPct === 0 ? 'strong' : 'no', value: m.earthYearPct === 0 ? 'Earth never in view all year: shielded from Earth' : `Earth in view ${Math.round(m.earthYearPct)} % of the year` }
      : { fit: m.earthFraction === 0 ? 'possible' : 'no', value: m.earthFraction === 0 ? 'Earth hidden for the whole mission' : `Earth in view ${pct(m.earthFraction)} of the mission` },
    score: (m) => (m.earthYearPct === 0 ? 2 + m.sunFraction : m.earthFraction === 0 ? 1 + m.sunFraction : -m.earthFraction),
    dependsOnDate: false,
  },
]

const RAD = Math.PI / 180

/** Great-circle distance in km. */
export function arcKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const c = Math.sin(lat1 * RAD) * Math.sin(lat2 * RAD) + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon1 - lon2) * RAD)
  return MOON_RADIUS_KM * Math.acos(Math.max(-1, Math.min(1, c)))
}

/** Nearest PSR edge, treating each PSR as a circle of equal area around its centroid. */
export function nearestPsr(latDeg: number, lonDeg: number, psrs: Psr[]): { edgeKm: number; psr: Psr } | null {
  let best: { edgeKm: number; psr: Psr } | null = null
  for (const psr of psrs) {
    const edgeKm = Math.max(0, arcKm(latDeg, lonDeg, psr.latDeg, psr.lonDeg) - Math.sqrt(psr.areaKm2 / Math.PI))
    if (!best || edgeKm < best.edgeKm) best = { edgeKm, psr }
  }
  return best
}

const longest = (windows: VisibilityWindow[]) => windows.reduce((max, w) => Math.max(max, w.endS - w.startS), 0)

/** Slope at the place: its own map cell for a map point, the map centre for a catalogue site. */
export function placeSlopeDeg(data: SiteData): number | null {
  const map = data.map
  if (!map) return null
  const cell = /:r(\d+)c(\d+)$/.exec(data.site.id)
  const row = cell ? Number(cell[1]) : Math.floor(map.grid.ny / 2)
  const col = cell ? Number(cell[2]) : Math.floor(map.grid.nx / 2)
  return map.slopeDeg[row * map.grid.nx + col] ?? null
}

/** PSRs are mapped for the south pole only (latitudes south of 80° S). */
const PSR_LIST_LIMIT_DEG = -80

export function researchMetrics(data: SiteData, result: ScenarioResult, psrs: Psr[]): ResearchMetrics {
  const { latDeg, lonDeg } = data.site
  const near = latDeg <= PSR_LIST_LIMIT_DEG + 5 ? nearestPsr(latDeg, lonDeg, psrs) : null
  const usable = near && near.edgeKm <= 200 ? near : null
  return {
    siteId: data.site.id,
    latDeg,
    lonDeg,
    durationS: result.durationS,
    sunFraction: result.summary.sunVisibleFraction,
    earthFraction: result.summary.earthVisibleFraction,
    bothFraction: result.summary.bothVisibleFraction,
    longestSunS: longest(result.sunWindows),
    longestEarthS: longest(result.earthWindows),
    longestBothS: longest(result.bothWindows),
    psrEdgeKm: usable ? usable.edgeKm : null,
    psrName: usable ? usable.psr.name : null,
    slopeDeg: placeSlopeDeg(data),
    earthYearPct: data.season?.year.earthPct ?? null,
    region: data.site.category === 'contrast' ? 'contrast' : 'polar',
  }
}

export interface Alternative {
  metrics: ResearchMetrics
  fit: Fit
  value: string
  distanceKm: number
}

/**
 * Best other places for one research type: those that fit it, not steeper than the landing
 * limit where the slope is known, ranked by the type's measurement. A south-polar place gets
 * south-polar alternatives only; a contrast point may be compared with any place.
 */
export function alternativesFor(type: ResearchType, selected: ResearchMetrics, candidates: ResearchMetrics[], count = 3): Alternative[] {
  return candidates
    .filter((m) => m.siteId !== selected.siteId)
    .filter((m) => selected.region === 'contrast' || m.region === 'polar')
    .filter((m) => m.slopeDeg === null || m.slopeDeg <= MAX_ALTERNATIVE_SLOPE_DEG)
    .map((m) => ({ metrics: m, ...type.assess(m), distanceKm: arcKm(selected.latDeg, selected.lonDeg, m.latDeg, m.lonDeg) }))
    .filter((a) => a.fit !== 'no')
    .sort((a, b) => (a.fit === b.fit ? type.score(b.metrics) - type.score(a.metrics) : a.fit === 'strong' ? -1 : 1))
    .slice(0, count)
}

// ---------------------------------------------------------------------------

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
