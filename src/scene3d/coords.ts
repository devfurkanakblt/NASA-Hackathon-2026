import type { BodyState, BodyStatus, HorizonProfile, PanelState, Vec3 } from './types.ts'

/**
 * Scene frame (three.js, right-handed, Y up), origin on the ground at the site:
 *   +X = east, +Y = up, −Z = north.
 * All positions are in metres.
 */

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

/** Observer height above ground used by every calculation in the project (plan §3). */
export const OBSERVER_HEIGHT_M = 2

const AU_M = 1.495978707e11
/** Sun's angular radius at 1 au, as in the data contract's partial-disc note. */
const SUN_ANGULAR_RADIUS_1AU_DEG = 0.2666
/** Mean Earth radius; only used to draw Earth's disc to scale. */
const EARTH_RADIUS_M = 6_371_000

/** Apparent diameter of the Sun at a given distance (falls back to 1 au). */
export function sunAngularDiameterDeg(distanceM?: number): number {
  return (2 * SUN_ANGULAR_RADIUS_1AU_DEG * AU_M) / (distanceM && distanceM > 0 ? distanceM : AU_M)
}

/** Apparent diameter of Earth at a given distance (falls back to the mean lunar distance). */
export function earthAngularDiameterDeg(distanceM?: number): number {
  return 2 * Math.asin(EARTH_RADIUS_M / (distanceM && distanceM > EARTH_RADIUS_M ? distanceM : 3.844e8)) * RAD2DEG
}

export function normalizeAzimuth(azDeg: number): number {
  const a = azDeg % 360
  return a < 0 ? a + 360 : a
}

/** Unit vector in the scene frame for a direction given as azimuth / elevation. */
export function azElToUnitVector(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * DEG2RAD
  const el = elDeg * DEG2RAD
  const c = Math.cos(el)
  return [c * Math.sin(az), Math.sin(el), -c * Math.cos(az)]
}

/** Inverse of {@link azElToUnitVector}; the input does not need to be normalised. */
export function vectorToAzEl(v: Vec3): { azDeg: number; elDeg: number } {
  const [x, y, z] = v
  const horizontal = Math.hypot(x, z)
  return {
    azDeg: normalizeAzimuth(Math.atan2(x, -z) * RAD2DEG),
    elDeg: Math.atan2(y, horizontal) * RAD2DEG,
  }
}

/**
 * Terrain-horizon elevation at any azimuth: circular linear interpolation,
 * identical to `horizonAt` in the data contract's shared visibility rule.
 */
export function horizonElevationAt(profile: HorizonProfile, azDeg: number): number {
  const n = profile.elevDeg.length
  if (n === 0) return 0
  const pos = normalizeAzimuth(azDeg) / profile.azStepDeg
  const i0 = Math.floor(pos) % n
  const i1 = (i0 + 1) % n
  const t = pos - Math.floor(pos)
  return profile.elevDeg[i0] * (1 - t) + profile.elevDeg[i1] * t
}

/** Distance to the terrain that forms the horizon at an azimuth (nearest sample), if known. */
export function horizonDistanceAt(profile: HorizonProfile, azDeg: number): number | undefined {
  const d = profile.distanceM
  if (!d || d.length === 0) return undefined
  return d[Math.round(normalizeAzimuth(azDeg) / profile.azStepDeg) % d.length]
}

/**
 * Why a body is (not) usable. `visible` is taken as given — it is the engine's answer —
 * and only the reason for "not visible" is derived here.
 */
export function bodyStatus(body: BodyState, geometricHorizonDeg = 0): BodyStatus {
  if (body.visible) return 'visible'
  return body.elDeg > geometricHorizonDeg ? 'terrain-blocked' : 'below-horizon'
}

/** Plan defaults: 2 m² panel in ideal-tracking mode. */
export const DEFAULT_PANEL: PanelState = { mode: 'tracking', areaM2: 2, fixedNormalAzDeg: 0, fixedNormalElDeg: 0 }

/** Panel normal in the scene frame: towards the Sun when tracking, fixed otherwise. */
export function panelNormal(panel: PanelState, sun: Pick<BodyState, 'azDeg' | 'elDeg'>): Vec3 {
  return panel.mode === 'tracking'
    ? azElToUnitVector(sun.azDeg, sun.elDeg)
    : azElToUnitVector(panel.fixedNormalAzDeg, panel.fixedNormalElDeg)
}

/** Cosine of the Sun's incidence angle on the panel, clamped to 0 for back-lit panels. */
export function cosIncidence(normal: Vec3, sun: Pick<BodyState, 'azDeg' | 'elDeg'>): number {
  const s = azElToUnitVector(sun.azDeg, sun.elDeg)
  return Math.max(0, normal[0] * s[0] + normal[1] * s[1] + normal[2] * s[2])
}

/** True when the representative panel should be drawn as producing power. */
export function panelIsLit(panel: PanelState, sun: BodyState): boolean {
  return sun.visible && cosIncidence(panelNormal(panel, sun), sun) > 0
}

/** Width and height (m) of the representative panel for a given area, 1.6 : 1 aspect. */
export function panelSize(areaM2: number): { widthM: number; heightM: number } {
  const area = Math.max(0.01, areaM2)
  const widthM = Math.sqrt(area * 1.6)
  return { widthM, heightM: area / widthM }
}
