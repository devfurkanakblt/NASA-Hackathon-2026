/**
 * Shapes of the files in `public/data/`, as defined in docs/data-contract.md (v1).
 * Angles in degrees, lengths in metres, times UTC; azimuth clockwise from local north.
 */

export interface SiteEntry {
  id: string
  name: string
  latDeg: number
  lonDeg: number
  /** Height of the ground at the site above the 1737.4 km reference sphere. */
  surfaceElevationM: number
  observerHeightM: number
  coordSource: string
  demNear: string
  demFar: string
  label: string
  warnings: string[]
  derivedFrom?: string
  derivation?: string
  /** `contrast`: a point outside the south polar region, for educational comparison. */
  category?: string
}

export interface SitesDoc {
  version: number
  coverage: { startUtc: string; endUtc: string; stepS: number }
  sites: SiteEntry[]
}

/** One body's series; sample `i` is at `startUtc + i * stepS`. */
export interface BodySeries {
  azDeg: number[]
  elDeg: number[]
  distanceM: number[]
}

export interface EphemerisDoc {
  siteId: string
  /** `jpl-horizons` or `skyfield-de421`. */
  source: string
  startUtc: string
  stepS: number
  count: number
  sun: BodySeries
  earth: BodySeries
}

export interface HorizonDoc {
  azStepDeg: number
  count: number
  /** Terrain horizon elevation at azimuth `i * azStepDeg`. */
  elevDeg: number[]
  /** Distance to the terrain point that forms the horizon. */
  distanceM: number[]
  warnings?: string[]
}

export interface TerrainDoc {
  sizeM: number
  n: number
  cellM: number
  zM: number[]
}

/** Summary fields shared by the year, the main period and each month of `season.json`. */
export interface SeasonSummary {
  samples: number
  sunPct: number
  earthPct: number
  bothPct: number
  sunDiskFractionMean: number
  longestNoSunS: number
  longestNoEarthS: number
  /** Sun elevation above the local horizontal plane (no terrain). */
  sunElMaxDeg: number
  sunElMinDeg: number
  earthElMaxDeg: number
}

/** One-year monthly summary (`{site}/season.json`). */
export interface SeasonDoc {
  version: number
  siteId: string
  source: string
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  year: SeasonSummary
  mainPeriod: SeasonSummary & { startUtc: string; endUtc: string }
  /** Calendar months (UTC); `month` is "2026-11". */
  months: (SeasonSummary & { month: string; startIndex: number; endIndex: number })[]
}

/**
 * Regional ±3 km summary grid around the site (`{site}/map.json`). Row-major, row 0 = south,
 * column 0 = west; cell centre east = -halfSizeM + col*spacingM, north = -halfSizeM + row*spacingM.
 * Values are summaries for `coverage`; there is no time series per cell.
 */
export interface MapDoc {
  version: number
  siteId: string
  grid: { nx: number; ny: number; spacingM: number; halfSizeM: number }
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  latDeg: number[]
  lonDeg: number[]
  surfaceElevationM: number[]
  sunPct: number[]
  earthPct: number[]
  bothPct: number[]
  sunDiskFractionMean: number[]
  longestNoSunS: number[]
  longestNoEarthS: number[]
  slopeDeg: number[]
  method?: Record<string, string | number>
  warnings?: string[]
}

/** Everything the app knows about one site. */
export interface SiteData {
  site: SiteEntry
  ephemeris: EphemerisDoc
  horizon: HorizonDoc
  terrain: TerrainDoc
  /** One-year monthly summary; optional so an older data set still opens. */
  season?: SeasonDoc
  /** Regional grid; contrast points have none. */
  map?: MapDoc
}

export interface LoadedData {
  sites: SitesDoc
  bySite: Record<string, SiteData>
}
