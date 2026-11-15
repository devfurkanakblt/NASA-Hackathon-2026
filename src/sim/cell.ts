/**
 * A regional map cell as a full scenario site. The Sun / Earth series of the site centre
 * (JPL Horizons az/el/range) is rebuilt as Moon-fixed positions and re-projected into the
 * cell's own local frame — the TypeScript twin of `regional_map.body_vectors` + `local_azel`.
 * Near the pole a few km change the azimuth by degrees, and the Earth's parallax over a few
 * km is included because the range is kept.
 */
import type { BodySeries, EphemerisDoc, Provenance, SiteData } from '../data/contract.ts'
import { cellHorizon, type CellHorizons, type ExtendedHeader, type RefinedCell, type RefinedDoc } from '../data/extended.ts'

export const MOON_RADIUS_M = 1737400
export const CELL_LABEL = 'Regional screening estimate (1° horizon), not a catalogue site'
/** A map cell revalidated with the same 0.1° horizon as a catalogue site; still not a catalogue site. */
export const REFINED_CELL_LABEL = 'Map point revalidated with the 0.1° catalogue horizon, not a catalogue site'

const RAD = Math.PI / 180

type Vec = [number, number, number]
interface Frame { e: Vec; n: Vec; u: Vec }

function enu(latDeg: number, lonDeg: number): Frame {
  const p = latDeg * RAD
  const l = lonDeg * RAD
  return {
    u: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
    n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    e: [-Math.sin(l), Math.cos(l), 0],
  }
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface Observer { latDeg: number; lonDeg: number; eyeM: number }

/** The ephemeris seen from `cell`, given the one seen from `centre`. */
export function cellEphemeris(eph: EphemerisDoc, centre: Observer, cell: Observer): EphemerisDoc {
  const fc = enu(centre.latDeg, centre.lonDeg)
  const fx = enu(cell.latDeg, cell.lonDeg)
  const rc = MOON_RADIUS_M + centre.eyeM
  const rx = MOON_RADIUS_M + cell.eyeM
  // cell position minus centre position, Moon-fixed
  const d: Vec = [rx * fx.u[0] - rc * fc.u[0], rx * fx.u[1] - rc * fc.u[1], rx * fx.u[2] - rc * fc.u[2]]
  const project = (s: BodySeries): BodySeries => {
    const n = s.azDeg.length
    const azDeg = new Array<number>(n)
    const elDeg = new Array<number>(n)
    const distanceM = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const az = s.azDeg[i] * RAD
      const el = s.elDeg[i] * RAD
      const r = s.distanceM[i]
      const ce = Math.cos(el)
      const ue = ce * Math.sin(az)
      const un = ce * Math.cos(az)
      const uu = Math.sin(el)
      // body − cell = r·u − (p_cell − p_centre)
      const v: Vec = [
        r * (ue * fc.e[0] + un * fc.n[0] + uu * fc.u[0]) - d[0],
        r * (ue * fc.e[1] + un * fc.n[1] + uu * fc.u[1]) - d[1],
        r * (ue * fc.e[2] + un * fc.n[2] + uu * fc.u[2]) - d[2],
      ]
      const x = dot(v, fx.e)
      const y = dot(v, fx.n)
      const z = dot(v, fx.u)
      azDeg[i] = (((Math.atan2(x, y) / RAD) % 360) + 360) % 360
      elDeg[i] = Math.atan2(z, Math.hypot(x, y)) / RAD
      distanceM[i] = Math.hypot(x, y, z)
    }
    return { azDeg, elDeg, distanceM }
  }
  return { ...eph, sun: project(eph.sun), earth: project(eph.earth) }
}

/**
 * The refined entry of cell (row, col) when it can be used: the file belongs to this `cells.bin` and the
 * entry has the cell's own coordinate and eye. Anything else is ignored with a console warning.
 */
function usableRefined(refined: RefinedDoc | null | undefined, header: ExtendedHeader, id: string, cell: Observer): RefinedCell | undefined {
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

/**
 * Cell (row, col) of the site's regional map as a site: own horizon, own ephemeris, labelled.
 * With a usable `refined` entry the horizon is the 0.1° catalogue horizon of that cell; otherwise the 1° one.
 */
export function cellSiteData(base: SiteData, year: EphemerisDoc, cells: CellHorizons, header: ExtendedHeader, row: number, col: number, refined?: RefinedDoc | null): SiteData {
  const map = base.map
  if (!map) throw new RangeError(`${base.site.id} has no regional map.`)
  const { nx, ny } = map.grid
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= ny || col >= nx) {
    throw new RangeError(`Cell ${row},${col} is outside the ${nx}×${ny} map of ${base.site.id}.`)
  }
  const index = row * nx + col
  const s = base.site
  const { spacingM, halfSizeM } = map.grid
  const east = -halfSizeM + col * spacingM
  const north = -halfSizeM + row * spacingM
  const m = (v: number) => `${Math.abs(Math.round(v))} m`
  const where = east === 0 && north === 0 ? 'site centre' : `${m(east)} ${east >= 0 ? 'east' : 'west'}, ${m(north)} ${north >= 0 ? 'north' : 'south'} of the site centre`
  const cell: Observer = { latDeg: map.latDeg[index], lonDeg: map.lonDeg[index], eyeM: cells.eyeM[index] }
  const r = usableRefined(refined, header, `r${row}c${col}`, cell)
  const provenance: Provenance = {
    latDeg: cell.latDeg, lonDeg: cell.lonDeg, observerHeightM: s.observerHeightM, eyeM: cell.eyeM,
    ephemerisSource: year.source, dataHash: header.year.sha256,
    ...(r
      ? { horizonResolutionDeg: r.azStepDeg, horizonSource: 'refined-cell', precision: 'catalogue', coverageWarnings: [...r.warnings] }
      : { horizonResolutionDeg: cells.azStepDeg, horizonSource: 'map-cell', precision: 'regional screening estimate', coverageWarnings: [...(map.warnings ?? [])] }),
  }
  return {
    ...base,
    site: {
      ...s,
      id: `${s.id}:r${row}c${col}`,
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
    horizon: r
      ? { azStepDeg: r.azStepDeg, count: r.count, elevDeg: r.elevDeg, distanceM: r.distanceM, warnings: [...r.warnings] }
      : cellHorizon(cells, index),
    ephemeris: cellEphemeris(year, { latDeg: s.latDeg, lonDeg: s.lonDeg, eyeM: s.surfaceElevationM + s.observerHeightM }, cell),
    terrain: base.terrain,
    season: base.season,
    map,
    provenance,
  }
}
