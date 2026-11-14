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

/** Everything the app knows about one site. */
export interface SiteData {
  site: SiteEntry
  ephemeris: EphemerisDoc
  horizon: HorizonDoc
  terrain: TerrainDoc
}

export interface LoadedData {
  sites: SitesDoc
  bySite: Record<string, SiteData>
}
