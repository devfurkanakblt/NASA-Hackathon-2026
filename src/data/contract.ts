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
  version?: 1
  siteId: string
  /** `jpl-horizons` or `skyfield-de421`. */
  source: string
  generatedUtc?: string
  settings?: { center: string; refraction: boolean; observerHeightM: number; frame: string }
  startUtc: string
  stepS: number
  count: number
  sun: BodySeries
  earth: BodySeries
}

export interface HorizonDoc {
  version?: 1
  siteId?: string
  azStepDeg: number
  count: number
  /** Terrain horizon elevation at azimuth `i * azStepDeg`. */
  elevDeg: number[]
  /** Distance to the terrain point that forms the horizon; absent for regional map cells. */
  distanceM?: number[]
  warnings?: string[]
  params?: { nearRangeM: number; nearStepM: number; maxRangeM: number; farStepM: number; minRangeM: number; curvature: boolean }
}

export interface TerrainDoc {
  version?: 1
  siteId?: string
  frame?: string
  sizeM: number
  n: number
  cellM: number
  zM: number[]
  /** Runtime-only, validated C display detail; never changes the elevation grid. */
  normalDetail?: TerrainNormalDetail
}

export interface TerrainNormalDoc {
  version: 1
  siteId: string
  file: 'terrain-normal.png'
  sizeM: number
  n: number
  frame: 'Three object normal (+east,+up,-north)'
  sourceNativePixelM: number
  outputPixelM: number
  sha256: string
  source: {
    site: { latitudeDeg: number; longitudeDeg: number; surfaceElevationM: number; observerHeightM: number }
    url: string
    sha256: string
    method: string
    [key: string]: unknown
  }
}

export interface TerrainNormalDetail {
  manifest: TerrainNormalDoc
  /** Local asset URL, including the content hash to avoid stale display maps. */
  textureUrl: string
}

/** Optional registered-Earth visual extension, independent of the scientific ephemeris. */
export interface EarthOrientationDoc {
  version: 1
  siteId: string
  startUtc: string
  stepS: number
  count: number
  quaternionXyzw: [number, number, number, number][]
  sunDirectionAtEarth?: [number, number, number][]
  source: { method: string; textureBodyFrame: string; [key: string]: unknown }
}

/** Per-sample visibility summaries for a year, month or main evaluation period. */
export interface SeasonSummary {
  samples: number
  sunPct: number
  earthPct: number
  bothPct: number
  sunDiskFractionMean: number
  longestNoSunS: number
  longestNoEarthS: number
  sunElMaxDeg: number
  sunElMinDeg: number
  earthElMaxDeg: number
}

/** Annual data has its own coverage; it is not restricted to the mission ephemeris period. */
export interface SeasonDoc {
  version: number
  siteId: string
  source: string
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  year: SeasonSummary
  mainPeriod: SeasonSummary & { startUtc: string; endUtc: string }
  months: (SeasonSummary & { month: string; startIndex: number; endIndex: number })[]
}

/** Regional summary grid, row-major from south-west. A null metric is explicitly no data. */
export interface MapDoc {
  version: number
  siteId: string
  grid: { nx: number; ny: number; spacingM: number; halfSizeM: number }
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  latDeg: number[]
  lonDeg: number[]
  surfaceElevationM: (number | null)[]
  sunPct: (number | null)[]
  earthPct: (number | null)[]
  bothPct: (number | null)[]
  sunDiskFractionMean: (number | null)[]
  longestNoSunS: (number | null)[]
  longestNoEarthS: (number | null)[]
  slopeDeg: (number | null)[]
  method?: Record<string, string | number>
  warnings?: string[]
}

/** Everything the app knows about one site. */
export interface SiteData {
  site: SiteEntry
  ephemeris: EphemerisDoc
  horizon: HorizonDoc
  /** Visual-only data; its absence must not disable scientific results. */
  terrain?: TerrainDoc
  /** Coarse regional terrain around the patch (`terrain-far.json`), when it has been generated. */
  terrainFar?: TerrainDoc
  earthOrientation?: EarthOrientationDoc
  /** Always supplied by loadAllData; optional for existing direct engine fixtures. */
  visualWarnings?: string[]
  /** Optional regional and annual context panels from A/B. */
  map?: MapDoc
  season?: SeasonDoc
}

export interface LoadedData {
  sites: SitesDoc
  bySite: Record<string, SiteData>
}
