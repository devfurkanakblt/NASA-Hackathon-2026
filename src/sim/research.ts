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
import type { ScenarioResult } from './evaluate.ts'
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
