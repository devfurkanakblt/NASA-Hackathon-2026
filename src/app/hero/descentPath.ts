import { Vector3 } from 'three'

/**
 * Camera pose for the home-page descent, as a pure function of scroll progress (0..1).
 *
 * Frame: the shared Moon frame of the app (unit sphere, +Y north, +X longitude 0,
 * -Z longitude +90° E). The camera starts in front of the near side, follows the 0° meridian
 * south while closing in (log-spaced altitude, so the approach speed feels constant), passes
 * over the pole and settles at 87.5° S on the far meridian, looking back across the pole
 * towards the near side, where Earth hangs on the horizon. It then pitches from "looking
 * at the Moon" to "looking at the horizon" without ever rolling: the up vector is the
 * meridian tangent, transported continuously along the path.
 */

const DEG = Math.PI / 180
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const smootherstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10) }
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Sun direction for the scene: sub-solar point at 1.5° S, 60° E (gibbous disc, grazing polar light). */
export const SUN_DIRECTION = (() => {
  const lat = -1.5 * DEG, lon = 60 * DEG
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
})()

/** Final altitude in Moon radii (~10 km). */
export const FINAL_ALTITUDE = 0.006
/** Angle travelled south from the equator along the meridian; 92.5 = 87.5° S on the far side. */
const FINAL_SOUTH = 92.5
const START_SOUTH = 14

const emptyPose = (): DescentPose => ({ position: new Vector3(), forward: new Vector3(), up: new Vector3(), altitude: 0, latitude: 0 })

export interface DescentPose {
  position: Vector3
  forward: Vector3
  up: Vector3
  /** Height above the surface in Moon radii. */
  altitude: number
  /** Latitude under the camera, degrees. */
  latitude: number
}

/** Start distance that keeps the full disc at about two-thirds of the shorter screen side. */
export function startDistance(fovDeg: number, aspect: number) {
  const vHalf = fovDeg / 2 * DEG
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const half = Math.min(vHalf, hHalf)
  return 1 / Math.sin(half * 0.64)
}

/** The distant intro (and, past HANDOFF, the reference the landing path departs from). */
export function introPose(progress: number, fovDeg: number, aspect: number, out?: DescentPose): DescentPose {
  const p = clamp01(progress)
  const pose = out ?? emptyPose()

  // Travel south along the meridian, ahead of the descent: the camera is over the pole (and the
  // sharp NAC mosaic) before it gets low.
  const south = mix(START_SOUTH, FINAL_SOUTH, smootherstep(0, 0.64, p)) * DEG
  // Altitude interpolated in log space, easing in and out; held back early so the whole disc
  // stays in view for the first part of the scroll.
  const a0 = startDistance(fovDeg, aspect) - 1
  const e = Math.pow(smoothstep(0, 0.86, p), 1.4)
  const altitude = Math.exp(mix(Math.log(a0), Math.log(FINAL_ALTITUDE), e))
  // A slow drift in longitude so the approach curves instead of tracking a straight line.
  const lon = mix(-16, 0, smootherstep(0, 0.75, p)) * DEG

  const ex = Math.cos(lon), ez = -Math.sin(lon) // equator direction of the meridian
  const s = Math.sin(south), c = Math.cos(south)
  // Radial direction and the meridian tangent (north while south of the pole, continuous past it).
  const rx = ex * c, ry = -s, rz = ez * c
  const ux = ex * s, uy = c, uz = ez * s

  // Pitch from nadir (looking at the centre) to just below the horizon: the horizon dips
  // acos(1 / (1 + h)) at height h; keep it ~2° above the screen centre.
  const dip = Math.acos(1 / (1 + FINAL_ALTITUDE))
  const pitchMax = Math.PI / 2 - dip - 2 * DEG
  const pitch = pitchMax * smootherstep(0.5, 0.9, p)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)

  const r = 1 + altitude
  pose.position.set(rx * r, ry * r, rz * r)
  pose.forward.set(-rx * cp + ux * sp, -ry * cp + uy * sp, -rz * cp + uz * sp).normalize()
  pose.up.set(rx * sp + ux * cp, ry * sp + uy * cp, rz * sp + uz * cp).normalize()
  pose.altitude = altitude
  pose.latitude = -(90 - Math.abs(90 - south / DEG))
  return pose
}


/** Moon radius in km, for the telemetry readout. */
export const MOON_RADIUS_KM = 1737.4
const R_M = MOON_RADIUS_KM * 1000

/*
 * Landing path (p > HANDOFF). Coordinates are the LOLA south polar stereographic grid in metres
 * (x towards 90° E, y towards 0°), the same grid as the terrain data, so the path is placed on
 * the measured surface exactly. The camera crosses the pole high and looking down (as in the
 * intro), turns over the far side, then flies forward and down towards Shackleton, tilting
 * from nadir to a low, forward view with the Sun just off the right edge of the frame.
 */
export const HANDOFF = 0.45
const TURN_AT = 0.64
const ARRIVE_AT = 0.97

/** Centre of Shackleton crater (89.67° S, 129.8° E). */
export const SHACKLETON: [number, number] = [7680, -6400]
/** Final heading on the map: towards longitude 24° E, which puts the Sun ~36° right, at the frame edge. */
const HEADING: [number, number] = [Math.sin(24 * DEG), Math.cos(24 * DEG)]
const RIGHT: [number, number] = [HEADING[1], -HEADING[0]]
/** Final ground point: 20 km before the crater centre, 4 km to the right (crater left of centre). */
export const FINAL_GROUND: [number, number] = [
  SHACKLETON[0] - 20000 * HEADING[0] + 4000 * RIGHT[0],
  SHACKLETON[1] - 20000 * HEADING[1] + 4000 * RIGHT[1],
]
/** Where the forward run begins: 52 km back along the heading, on the far side of the pole. */
export const TURN_GROUND: [number, number] = [FINAL_GROUND[0] - 52000 * HEADING[0], FINAL_GROUND[1] - 52000 * HEADING[1]]
/** Final camera height above the 1737.4 km sphere, metres (ground there is about +1 km). */
export const FINAL_HEIGHT_M = 4600
/** Look this far below the horizontal at the end: the horizon sits a little above centre. */
const FINAL_LOOK_DOWN = 6.2 * DEG

/** Stereographic metres to a unit direction in the Moon frame. */
export function mapToDirection(x: number, y: number, out = new Vector3()) {
  const c = 2 * Math.atan(Math.hypot(x, y) / (2 * R_M))
  const lam = Math.atan2(x, y)
  return out.set(Math.sin(c) * Math.cos(lam), -Math.cos(c), -Math.sin(c) * Math.sin(lam))
}

export function directionToMap(d: Vector3): [number, number] {
  const c = Math.acos(Math.max(-1, Math.min(1, -d.y / d.length())))
  const lam = Math.atan2(-d.z, d.x)
  const rho = 2 * R_M * Math.tan(c / 2)
  return [rho * Math.sin(lam), rho * Math.cos(lam)]
}

const tmpIntro = emptyPose()
const tmpEnd = emptyPose()
const radial = new Vector3()
const tangent = new Vector3()

export function descentPose(progress: number, fovDeg: number, aspect: number, out?: DescentPose): DescentPose {
  const p = clamp01(progress)
  const pose = out ?? emptyPose()
  const intro = introPose(p, fovDeg, aspect, tmpIntro)
  if (p <= HANDOFF) {
    pose.position.copy(intro.position); pose.forward.copy(intro.forward); pose.up.copy(intro.up)
    pose.altitude = intro.altitude; pose.latitude = intro.latitude
    return pose
  }

  // Ground track: drift the intro's polar crossing onto the turn point, then run forward to the end.
  let gx: number, gy: number
  if (p <= TURN_AT) {
    const [ix, iy] = directionToMap(intro.position)
    const [ex, ey] = directionToMap(introPose(TURN_AT, fovDeg, aspect, tmpEnd).position)
    const w = smoothstep(HANDOFF, TURN_AT, p)
    gx = ix + (TURN_GROUND[0] - ex) * w
    gy = iy + (TURN_GROUND[1] - ey) * w
  } else {
    const s = smootherstep(TURN_AT, ARRIVE_AT, p)
    gx = mix(TURN_GROUND[0], FINAL_GROUND[0], s)
    gy = mix(TURN_GROUND[1], FINAL_GROUND[1], s)
  }
  mapToDirection(gx, gy, radial)

  // Height: log-spaced from the hand-off down to the final height, joined smoothly to the intro.
  const a45 = introPose(HANDOFF, fovDeg, aspect, tmpEnd).altitude
  const aEnd = FINAL_HEIGHT_M / R_M
  const landing = Math.exp(mix(Math.log(a45), Math.log(aEnd), smoothstep(HANDOFF, ARRIVE_AT, p)))
  const altitude = Math.exp(mix(Math.log(intro.altitude), Math.log(landing), smoothstep(HANDOFF, 0.55, p)))

  // Heading: from the intro's screen-up (the meridian tangent, already pointing roughly along the
  // final heading) to the final heading, so tilting up never needs a sudden yaw.
  const ux = -intro.up.z, uy = intro.up.x // world tangent -> map direction (near the pole)
  const ul = Math.hypot(ux, uy) || 1
  const w = smoothstep(HANDOFF, 0.8, p)
  const hx = mix(ux / ul, HEADING[0], w), hy = mix(uy / ul, HEADING[1], w)
  tangent.set(hy, 0, -hx) // map direction -> world tangent
  tangent.addScaledVector(radial, -tangent.dot(radial)).normalize()

  // Tilt from nadir to the low forward view.
  const pitchMax = Math.PI / 2 - FINAL_LOOK_DOWN
  const pitch = pitchMax * smootherstep(0.52, 0.93, p)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)

  pose.position.copy(radial).multiplyScalar(1 + altitude)
  pose.forward.copy(radial).multiplyScalar(-cp).addScaledVector(tangent, sp).normalize()
  pose.up.copy(radial).multiplyScalar(sp).addScaledVector(tangent, cp).normalize()
  // Ease out of the intro over the first few percent so the hand-off has no visible seam.
  const join = smoothstep(HANDOFF, HANDOFF + 0.06, p)
  if (join < 1) {
    pose.forward.lerpVectors(intro.forward, pose.forward, join).normalize()
    pose.up.lerpVectors(intro.up, pose.up, join)
    pose.up.addScaledVector(pose.forward, -pose.up.dot(pose.forward)).normalize()
  }
  pose.altitude = altitude
  pose.latitude = Math.asin(Math.max(-1, Math.min(1, radial.y))) / DEG
  return pose
}
