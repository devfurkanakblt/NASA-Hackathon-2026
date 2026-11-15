/**
 * Helpers for the regional map (`map.json`): cell lookup, where other sites fall on the grid and
 * the colour ramps. Kept out of the component so they can be tested on the real files.
 */
import type { MapDoc, SiteEntry } from '../data/contract.ts'

export type MapLayer = 'sunPct' | 'earthPct' | 'bothPct' | 'slopeDeg'

export const LAYERS: { key: MapLayer; label: string; unit: string; max: number }[] = [
  { key: 'sunPct', label: 'Sun in view', unit: '%', max: 100 },
  { key: 'earthPct', label: 'Earth in view', unit: '%', max: 100 },
  { key: 'bothPct', label: 'Both in view', unit: '%', max: 100 },
  { key: 'slopeDeg', label: 'Slope', unit: '°', max: 30 },
]

export interface MapCell {
  index: number
  row: number
  col: number
  /** Cell centre relative to the site centre, metres. */
  eastM: number
  northM: number
  distanceM: number
  sunPct: number | null
  earthPct: number | null
  bothPct: number | null
  slopeDeg: number | null
  longestNoSunS: number | null
  longestNoEarthS: number | null
  surfaceElevationM: number | null
}

export function cellAt(map: MapDoc, row: number, col: number): MapCell {
  const { nx, spacingM, halfSizeM } = map.grid
  const index = row * nx + col
  const eastM = -halfSizeM + col * spacingM
  const northM = -halfSizeM + row * spacingM
  return {
    index,
    row,
    col,
    eastM,
    northM,
    distanceM: Math.hypot(eastM, northM),
    sunPct: map.sunPct[index],
    earthPct: map.earthPct[index],
    bothPct: map.bothPct[index],
    slopeDeg: map.slopeDeg[index],
    longestNoSunS: map.longestNoSunS[index],
    longestNoEarthS: map.longestNoEarthS[index],
    surfaceElevationM: map.surfaceElevationM[index],
  }
}

/** The centre cell (the site itself). */
export const centreCell = (map: MapDoc) => cellAt(map, Math.floor(map.grid.ny / 2), Math.floor(map.grid.nx / 2))

const MOON_RADIUS_M = 1737400
const RAD = Math.PI / 180

/** Great-circle distance on the 1737.4 km sphere, metres. */
export function arcM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Other sites that lie on this map (e.g. Site04R on Site04's map), placed on their nearest cell
 * using the cells' own lat/lon. A site further than one cell from every cell centre is left out.
 */
export function sitesOnMap(map: MapDoc, sites: SiteEntry[]): { site: SiteEntry; cell: MapCell }[] {
  const { nx, ny, spacingM } = map.grid
  const out: { site: SiteEntry; cell: MapCell }[] = []
  for (const site of sites) {
    if (site.id === map.siteId) continue
    let best = -1
    let bestM = Infinity
    for (let i = 0; i < nx * ny; i++) {
      const d = arcM(site.latDeg, site.lonDeg, map.latDeg[i], map.lonDeg[i])
      if (d < bestM) {
        bestM = d
        best = i
      }
    }
    if (best >= 0 && bestM <= spacingM) out.push({ site, cell: cellAt(map, Math.floor(best / nx), best % nx) })
  }
  return out
}

type Rgb = [number, number, number]
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb

/** Single-hue ramps for the dark card: low values sink toward the surface, high values are light. */
const RAMPS: Record<'sun' | 'earth' | 'neutral', Rgb[]> = {
  // Brand meaning: Sun shares in the Sun's yellow, Earth shares in Earth's blue, the rest neutral.
  sun: ['#16140f', '#2e240c', '#4f3a0a', '#7a5306', '#a86a00', '#d99a2b', '#ffd166', '#ffe7a8'].map(hex),
  earth: ['#0f1526', '#15224a', '#1d3373', '#2f56c9', '#5274d6', '#7895e8', '#9db7ff', '#cddbff'].map(hex),
  neutral: ['#14181f', '#232a36', '#363f4e', '#4c5668', '#677184', '#8a93a4', '#aab3c2', '#e8ecf3'].map(hex),
}

export const rampFor = (layer: MapLayer) => (layer === 'sunPct' ? RAMPS.sun : layer === 'earthPct' ? RAMPS.earth : RAMPS.neutral)

/** Colour of `t` in 0–1 on a ramp (linear between stops). */
export function rampColor(ramp: Rgb[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const f = x - i
  return [0, 1, 2].map((c) => Math.round(ramp[i][c] * (1 - f) + ramp[i + 1][c] * f)) as Rgb
}

export const rgbCss = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`
