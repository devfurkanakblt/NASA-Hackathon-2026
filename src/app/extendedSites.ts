/**
 * Scenario site ids beyond the catalogue: a regional map cell (`Site01:r36c32`) and any start
 * date in the one-year coverage. Decides which per-site files a scenario needs and turns a
 * scenario's id into the `SiteData` the unchanged engine runs on.
 */
import type { EphemerisDoc, SiteData } from '../data/contract.ts'
import type { CellHorizons, ExtendedHeader } from '../data/extended.ts'
import { cellSiteData } from '../sim/cell.ts'
import { arcM } from './mapGrid.ts'

export function cellId(siteId: string, row: number, col: number): string {
  return `${siteId}:r${row}c${col}`
}

const CELL_ID = /^([^:@,]+):r(\d+)c(\d+)$/

export function parseCellId(id: string): { siteId: string; row: number; col: number } | null {
  const m = CELL_ID.exec(id)
  return m ? { siteId: m[1], row: Number(m[2]), col: Number(m[3]) } : null
}

/** A catalogue site id, or a cell id inside the regional map of a catalogue site. */
export function isKnownSiteId(id: string, bySite: Record<string, SiteData>): boolean {
  const cell = parseCellId(id)
  if (!cell) return id in bySite
  const map = bySite[cell.siteId]?.map
  return !!map && cell.row < map.grid.ny && cell.col < map.grid.nx
}

export type Loadable<T> = T | 'loading' | 'error'

export interface ExtendedState {
  years: Record<string, Loadable<EphemerisDoc>>
  cells: Record<string, Loadable<CellHorizons>>
  /** `extended.json` per site; a map point also needs it for the data hash. */
  headers?: Record<string, ExtendedHeader>
}

export type Resolved = { data: SiteData } | { loading: string } | { error: string }

const DAY_MS = 86400 * 1000

/**
 * True when the scenario needs the one-year series: every map cell (its ephemeris is rebuilt
 * from the year series), and a catalogue site whose mission (`durationDays` from the start)
 * would end after the two-month coverage.
 */
export function needsYear(id: string, startUtc: string, coverageEndUtc: string, durationDays = 1): boolean {
  if (parseCellId(id)) return true
  return Date.parse(startUtc) + durationDays * DAY_MS > Date.parse(coverageEndUtc)
}

const isLoaded = <T>(v: Loadable<T> | undefined): v is T => v !== undefined && v !== 'loading' && v !== 'error'

/** Data the engine should use for a scenario's site id: year series when loaded, a cell when its files are loaded. */
export function resolveSiteData(id: string, startUtc: string, coverageEndUtc: string, bySite: Record<string, SiteData>, ext: ExtendedState, durationDays = 1): Resolved {
  const cell = parseCellId(id)
  if (cell) {
    if (!isKnownSiteId(id, bySite)) return { error: `No regional map point ${id}.` }
    const base = bySite[cell.siteId]
    const year = ext.years[cell.siteId]
    const cells = ext.cells[cell.siteId]
    if (year === 'error' || cells === 'error') return { error: 'Map point data not available.' }
    const header = ext.headers?.[cell.siteId]
    if (!isLoaded(year) || !isLoaded(cells) || !header) return { loading: 'Loading map point…' }
    return { data: cellSiteData(base, year, cells, header, cell.row, cell.col) }
  }
  const base = bySite[id]
  if (!base) return { error: `No data for site ${id}.` }
  // Inside the two months the validated float64 series is used, so the demo numbers cannot shift.
  if (!needsYear(id, startUtc, coverageEndUtc, durationDays)) return { data: base }
  const year = ext.years[id]
  if (year === 'error') return { error: 'One-year data not available.' }
  if (!isLoaded(year)) return { loading: 'Loading one-year data…' }
  return { data: { ...base, ephemeris: year } }
}

/** Base site ids whose `year.bin` / `cells.bin` the scenarios need. */
export function sitesNeeded(scenarios: { siteId: string; startUtc: string }[], coverageEndUtc: string, durationDays = 1): { years: string[]; cells: string[] } {
  const years = new Set<string>()
  const cells = new Set<string>()
  for (const { siteId, startUtc } of scenarios) {
    const cell = parseCellId(siteId)
    const base = cell ? cell.siteId : siteId
    if (needsYear(siteId, startUtc, coverageEndUtc, durationDays)) years.add(base)
    if (cell) cells.add(base)
  }
  return { years: [...years], cells: [...cells] }
}

export const OUTSIDE_MAPS = 'Outside the ±3 km maps around the polar sites.'

/** Longitude in (−180, 180]. */
export const normalizeLon = (lon: number) => {
  const x = ((lon % 360) + 360) % 360
  return x > 180 ? x - 360 : x
}

/** Nearest regional map cell to a coordinate, over every site map; an error further than one cell spacing from all of them. */
export function snapToCell(latDeg: number, lonDeg: number, bySite: Record<string, SiteData>): { siteId: string; row: number; col: number; distanceM: number } | { error: string } {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return { error: 'Enter latitude and longitude in degrees.' }
  if (latDeg < -90 || latDeg > 90) return { error: 'Latitude must be between −90° and 90°.' }
  const lon = normalizeLon(lonDeg)
  let best: { siteId: string; row: number; col: number; distanceM: number; spacingM: number } | null = null
  for (const [siteId, data] of Object.entries(bySite)) {
    const map = data.map
    if (!map || parseCellId(siteId)) continue
    const { nx } = map.grid
    for (let i = 0; i < map.latDeg.length; i++) {
      const d = arcM(latDeg, lon, map.latDeg[i], map.lonDeg[i])
      if (!best || d < best.distanceM) best = { siteId, row: Math.floor(i / nx), col: i % nx, distanceM: d, spacingM: map.grid.spacingM }
    }
  }
  if (!best || best.distanceM > best.spacingM) return { error: OUTSIDE_MAPS }
  const { siteId, row, col, distanceM } = best
  return { siteId, row, col, distanceM }
}
