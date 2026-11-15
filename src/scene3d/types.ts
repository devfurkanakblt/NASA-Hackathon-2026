/**
 * Data the 3D mission view consumes, as defined by the team's data contract v1
 * (docs/data-contract.md). The JSON files in `public/data/` can be passed in as they are.
 *
 * Conventions:
 *  - angles in degrees, lengths in metres, times in UTC
 *  - azimuth is measured clockwise from local north: 0° = N, 90° = E, 180° = S, 270° = W
 *  - elevation is measured from the local horizontal plane, positive up
 *  - the observer eye is `observerHeightM` (2 m) above the ground at the site
 *
 * The 3D view never decides visibility on its own: `BodyState.visible` comes from the
 * simulation engine (terrain-horizon profile). The mesh is for visualisation only.
 */

import type { TerrainDoc, TerrainNormalDetail } from '../data/contract.ts'

/** `{siteId}/terrain.json` — down-sampled local elevation grid, local ENU, origin at the observer eye. */
export interface TerrainGrid {
  /** Side length of the square patch, in metres. */
  sizeM: number
  /** Cells per side. */
  n: number
  /** Cell size in metres (`sizeM / n`); values are cell means, located at cell centres. */
  cellM: number
  /**
   * Row-major `n * n` heights in metres relative to the observer eye (lunar curvature included).
   * Row 0 is the southernmost row, column 0 the westernmost column.
   */
  zM: ArrayLike<number>
  normalDetail?: TerrainNormalDetail
  imagery?: TerrainDoc['imagery']
}

/** `{siteId}/horizon.json` — terrain horizon as seen from the observer eye. */
export interface HorizonProfile {
  /** Azimuth step between samples (0.1°). */
  azStepDeg: number
  /** Horizon elevation angle per azimuth; sample `i` is at azimuth `i * azStepDeg`. */
  elevDeg: ArrayLike<number>
  /** Distance to the terrain point that forms the horizon at each azimuth. */
  distanceM?: ArrayLike<number>
}

/** Position of the Sun or Earth centre for the current time step (from `ephemeris.json`). */
export interface BodyState {
  azDeg: number
  elDeg: number
  /** Centre above the terrain horizon, as computed by the simulation engine. */
  visible: boolean
  /** Distance to the body; used only to draw its disc at the right angular size. */
  distanceM?: number
}

/** Sky track of a body over a time window (from `ephemeris.json`), drawn as its real path. */
export interface BodyPath {
  azDeg: ArrayLike<number>
  elDeg: ArrayLike<number>
  /** Per sample: centre above the terrain horizon — the same rule as `BodyState.visible`. */
  visible?: ArrayLike<boolean>
}

export type BodyStatus = 'visible' | 'terrain-blocked' | 'below-horizon'

export type PanelMode = 'tracking' | 'fixed'

export interface PanelState {
  mode: PanelMode
  /** Panel area in m² — only used to size the representative panel. */
  areaM2: number
  /** Panel normal for `fixed` mode. */
  fixedNormalAzDeg: number
  fixedNormalElDeg: number
}

export type CameraMode = 'map' | 'overview' | 'lander'

export type LookTarget = 'sun' | 'earth' | 'free'

export type Vec3 = [x: number, y: number, z: number]
