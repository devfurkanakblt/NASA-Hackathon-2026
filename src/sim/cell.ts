/**
 * A regional map cell as a full scenario site. The Sun / Earth series of the site centre
 * (JPL Horizons az/el/range) is rebuilt as Moon-fixed positions and re-projected into the
 * cell's own local frame — the TypeScript twin of `regional_map.body_vectors` + `local_azel`.
 * Near the pole a few km change the azimuth by degrees, and the Earth's parallax over a few
 * km is included because the range is kept.
 */
import type { EphemerisDoc, Provenance, SeasonDoc, SiteData } from '../data/contract.ts'
import { cellHorizon, type CellHorizons, type ExtendedHeader, type RefinedCell, type RefinedDoc } from '../data/extended.ts'
import { MOON_RADIUS_M, projectWindow, uncachedMoonFixedSeries, type MoonFixedSeries, type Observer } from './moonFixed.ts'
import { seasonFromSeries } from './season.ts'

export { MOON_RADIUS_M, type Observer }
export const CELL_LABEL = 'Regional screening estimate (1° horizon), not a catalogue site'
/** A map cell revalidated with the same 0.1° horizon as a catalogue site; still not a catalogue site. */
export const REFINED_CELL_LABEL = 'Map point revalidated with the 0.1° catalogue horizon, not a catalogue site'

/** The ephemeris seen from `cell`, given the one seen from `centre`. Uncached; searches use `moonFixedSeries`. */
export function cellEphemeris(eph: EphemerisDoc, centre: Observer, cell: Observer): EphemerisDoc {
  return projectWindow(uncachedMoonFixedSeries(eph, centre), cell, 0, eph.count)
}

/**
 * The refined entry of cell (row, col) when it can be used: the file belongs to this `cells.bin` and the
 * entry has the cell's own coordinate and eye. Anything else is ignored with a console warning.
 */
export function usableRefined(refined: RefinedDoc | null | undefined, header: ExtendedHeader, id: string, cell: Observer): RefinedCell | undefined {
  if (!refined) return undefined
  const entry = refined.cells[id]
  if (!entry) return undefined
  if (refined.cellsSha256 !== header.cells?.sha256) {
    console.warn(`${header.siteId}/refined.json is stale (cellsSha256 does not match extended.json); ${id} keeps the 1° screening horizon.`)
    return undefined
  }
  if (entry.eyeM !== cell.eyeM || Math.abs(entry.latDeg - cell.latDeg) > 1e-9 || Math.abs(entry.lonDeg - cell.lonDeg) > 1e-9) {
    console.warn(`${header.siteId}/refined.json: ${id} has another observer than the map cell; it keeps the 1° screening horizon.`)
    return undefined
  }
  return entry
}

/** Moon-fixed series per ephemeris object and centre observer, built once for searches over many cells. */
const seriesCache = new WeakMap<EphemerisDoc, Map<string, MoonFixedSeries>>()

function centreSeries(eph: EphemerisDoc, centre: Observer): MoonFixedSeries {
  const key = `${centre.latDeg},${centre.lonDeg},${centre.eyeM}`
  let byKey = seriesCache.get(eph)
  if (!byKey) seriesCache.set(eph, (byKey = new Map()))
  let mf = byKey.get(key)
  if (!mf) byKey.set(key, (mf = uncachedMoonFixedSeries(eph, centre)))
  return mf
}

/**
 * Samples `[startIndex, startIndex + count)` of the ephemeris seen from `cell`, as an ephemeris
 * of its own (its `startUtc` is that of sample `startIndex`). Same numbers as the matching part
 * of `cellEphemeris`; used for searches, where only the mission slice is needed.
 */
export function cellEphemerisSlice(eph: EphemerisDoc, centre: Observer, cell: Observer, startIndex: number, count: number): EphemerisDoc {
  if (!Number.isInteger(startIndex) || !Number.isInteger(count) || startIndex < 0 || count < 1 || startIndex + count > eph.count) {
    throw new RangeError(`Samples ${startIndex}..${startIndex + count - 1} outside the ${eph.count} of ${eph.siteId}.`)
  }
  return projectWindow(centreSeries(eph, centre), cell, startIndex, startIndex + count)
}

/** Observer at the catalogue site centre (eye height above the 1737.4 km sphere). */
export const centreObserver = (s: SiteData['site']): Observer => ({ latDeg: s.latDeg, lonDeg: s.lonDeg, eyeM: s.surfaceElevationM + s.observerHeightM })

/** Season tables per year series, cell set and cell id: a cell's summary is computed once. */
const seasonCache = new WeakMap<EphemerisDoc, WeakMap<CellHorizons, Map<string, SeasonDoc>>>()

function cachedSeason(year: EphemerisDoc, cells: CellHorizons, key: string, make: () => SeasonDoc): SeasonDoc {
  let byCells = seasonCache.get(year)
  if (!byCells) seasonCache.set(year, (byCells = new WeakMap()))
  let byKey = byCells.get(cells)
  if (!byKey) byCells.set(cells, (byKey = new Map()))
  let doc = byKey.get(key)
  if (!doc) byKey.set(key, (doc = make()))
  return doc
}

/**
 * Cell (row, col) of the site's regional map as a site: own horizon, own ephemeris, labelled,
 * and its own monthly / yearly summary (`season`) from that ephemeris and horizon — never the
 * catalogue centre's `season.json`. With a usable `refined` entry the horizon is the 0.1°
 * catalogue horizon of that cell; otherwise the 1° one.
 */
export function cellSiteData(base: SiteData, year: EphemerisDoc, cells: CellHorizons, header: ExtendedHeader, row: number, col: number, refined?: RefinedDoc | null): SiteData {
  const map = base.map
  if (!map) throw new RangeError(`${base.site.id} has no regional map.`)
  const { nx, ny } = map.grid
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= ny || col >= nx) {
    throw new RangeError(`Cell ${row},${col} is outside the ${nx}×${ny} map of ${base.site.id}.`)
  }
  if (cells.n !== nx * ny) throw new RangeError(`${base.site.id}: cells.bin has ${cells.n} cells, map.json ${nx * ny}.`)
  const index = row * nx + col
  const s = base.site
  const { spacingM, halfSizeM } = map.grid
  const east = -halfSizeM + col * spacingM
  const north = -halfSizeM + row * spacingM
  const m = (v: number) => `${Math.abs(Math.round(v))} m`
  const where = east === 0 && north === 0 ? 'site centre' : `${m(east)} ${east >= 0 ? 'east' : 'west'}, ${m(north)} ${north >= 0 ? 'north' : 'south'} of the site centre`
  const cell: Observer = { latDeg: map.latDeg[index], lonDeg: map.lonDeg[index], eyeM: cells.eyeM[index] }
  const id = `${s.id}:r${row}c${col}`
  const r = usableRefined(refined, header, `r${row}c${col}`, cell)
  const provenance: Provenance = {
    latDeg: cell.latDeg, lonDeg: cell.lonDeg, observerHeightM: s.observerHeightM, eyeM: cell.eyeM,
    ephemerisSource: year.source, dataHash: header.year.sha256,
    ...(r
      ? { horizonResolutionDeg: r.azStepDeg, horizonSource: 'refined-cell', precision: 'catalogue', coverageWarnings: [...r.warnings] }
      : { horizonResolutionDeg: cells.azStepDeg, horizonSource: 'map-cell', precision: 'regional screening estimate', coverageWarnings: [...(map.warnings ?? [])] }),
  }
  const horizon = r
    ? { azStepDeg: r.azStepDeg, count: r.count, elevDeg: r.elevDeg, distanceM: r.distanceM, warnings: [...r.warnings] }
    : cellHorizon(cells, index)
  const ephemeris = cellEphemeris(year, centreObserver(s), cell)
  const season = cachedSeason(year, cells, r ? `${id}:refined` : id, () => ({ ...seasonFromSeries({ ...ephemeris, siteId: id }, horizon), siteId: id }))
  return {
    ...base,
    site: {
      ...s,
      id,
      name: `${s.name} — map point`,
      latDeg: cell.latDeg,
      lonDeg: cell.lonDeg,
      surfaceElevationM: map.surfaceElevationM[index] ?? cell.eyeM - s.observerHeightM,
      label: r ? REFINED_CELL_LABEL : CELL_LABEL,
      coordSource: `Regional map of ${s.id} (map.json cell centre)`,
      derivedFrom: s.id,
      derivation: `regional map cell row ${row}, col ${col} (${where}); ${r ? '0.1° terrain horizon (revalidated)' : '1° terrain horizon'}`,
      warnings: [],
    },
    horizon,
    ephemeris,
    terrain: base.terrain,
    season,
    map,
    provenance,
  }
}
