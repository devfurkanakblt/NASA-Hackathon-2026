import type { EarthOrientationDoc } from '../data/contract.ts'
import { DEG2RAD, azElToUnitVector } from './coords.ts'
import type { Vec3 } from './types.ts'

export type QuaternionXyzw = [number, number, number, number]

function normalized(q: QuaternionXyzw): QuaternionXyzw {
  const length = Math.hypot(...q)
  return q.map(v => v / length) as QuaternionXyzw
}

function multiply(a: QuaternionXyzw, b: QuaternionXyzw): QuaternionXyzw {
  const [x, y, z, w] = a
  const [bx, by, bz, bw] = b
  return [w*bx + x*bw + y*bz - z*by, w*by - x*bz + y*bw + z*bx,
    w*bz + x*by - y*bx + z*bw, w*bw - x*bx - y*by - z*bz]
}

function slerp(a: QuaternionXyzw, b: QuaternionXyzw, t: number): QuaternionXyzw {
  let dot = a.reduce((sum, v, k) => sum + v * b[k], 0)
  if (dot < 0) { b = b.map(v => -v) as QuaternionXyzw; dot = -dot }
  if (dot > 0.9995) return normalized(a.map((v,k) => v*(1-t) + b[k]*t) as QuaternionXyzw)
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)))
  const wa = Math.sin((1-t)*theta) / Math.sin(theta)
  const wb = Math.sin(t*theta) / Math.sin(theta)
  return normalized(a.map((v,k) => v*wa + b[k]*wb) as QuaternionXyzw)
}

/** Radius of a sphere whose limb subtends the requested angular diameter. */
export function apparentSphereRadius(distance: number, diameterDeg: number): number {
  return distance * Math.sin(diameterDeg * DEG2RAD / 2)
}

/** Projected illuminated fraction, using directions from the body to Sun and to observer. */
export function illuminatedFraction(bodyDirection: Vec3, sunDirectionAtBody: Vec3): number {
  const length = Math.hypot(...bodyDirection) * Math.hypot(...sunDirectionAtBody)
  if (!(length > 0)) return 0
  const dot = bodyDirection.reduce((sum, v, i) => sum + v * sunDirectionAtBody[i], 0) / length
  return (1 - Math.max(-1, Math.min(1, dot))) / 2
}

/** Undo the position-only aim frame before applying the Earth-fixed to local-scene rotation. */
export function rotationInAimFrame(azDeg: number, elDeg: number, world: QuaternionXyzw): QuaternionXyzw {
  const x = elDeg * DEG2RAD / 2, y = -azDeg * DEG2RAD / 2
  const aim: QuaternionXyzw = [Math.sin(x)*Math.cos(y), Math.cos(x)*Math.sin(y), -Math.sin(x)*Math.sin(y), Math.cos(x)*Math.cos(y)]
  return normalized(multiply([-aim[0], -aim[1], -aim[2], aim[3]], normalized(world)))
}

function sampleOffset(doc: EarthOrientationDoc, utc: string): { i: number; j: number; f: number } | undefined {
  const t = (Date.parse(utc) - Date.parse(doc.startUtc)) / (1000 * doc.stepS)
  if (!Number.isFinite(t) || t < 0 || t > doc.count - 1) return undefined
  const i = Math.floor(t)
  return { i, j: Math.min(i + 1, doc.count - 1), f: t - i }
}

/** SLERP handles Earth's daily rotation and opposite-sign quaternion representations correctly. */
export function earthOrientationAt(doc: EarthOrientationDoc | undefined, utc: string): QuaternionXyzw | undefined {
  if (!doc) return undefined
  const s = sampleOffset(doc, utc)
  if (!s) return undefined
  const a = doc.quaternionXyzw[s.i]
  const b = doc.quaternionXyzw[s.j]
  if (!a || !b) return undefined
  return slerp(normalized(a), normalized(b), s.f)
}

/** The illumination vector is evaluated at Earth, rather than using lunar solar parallax. */
export function earthSunDirectionAt(doc: EarthOrientationDoc | undefined, utc: string): Vec3 | undefined {
  if (!doc?.sunDirectionAtEarth) return undefined
  const s = sampleOffset(doc, utc)
  if (!s) return undefined
  const a = doc.sunDirectionAtEarth[s.i]
  const b = doc.sunDirectionAtEarth[s.j]
  if (!a || !b) return undefined
  const v = a.map((value, k) => value * (1 - s.f) + b[k] * s.f) as Vec3
  const length = Math.hypot(...v)
  return length > 0 ? v.map(value => value / length) as Vec3 : undefined
}

/** Geographic mapping of Three's standard sphere: Greenwich at u=.5, east at u=.75. */
export function geographicUv(longitudeDeg: number, latitudeDeg: number): [number, number] {
  return [(((longitudeDeg + 180) / 360) % 1 + 1) % 1, (latitudeDeg + 90) / 180]
}

export function apparentEarthPhase(azDeg: number, elDeg: number, solarDirection: Vec3): number {
  return illuminatedFraction(azElToUnitVector(azDeg, elDeg), solarDirection)
}
