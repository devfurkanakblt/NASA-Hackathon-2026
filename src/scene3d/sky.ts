import { azElToUnitVector } from './coords.ts'
import type { BodyPath, Vec3 } from './types.ts'

export interface SkyPathLine {
  /** Points on a sphere of the given radius around the viewer. */
  points: Vec3[]
  /** Per point: body centre above the terrain horizon (true when the path carries no flags). */
  visible: boolean[]
}

/**
 * Polyline of a body's track across the sky. Long series are thinned to at most
 * `maxPoints` (plus the final sample) so a two-month track stays a light line.
 */
export function skyPathLine(path: BodyPath, radius: number, maxPoints = 3000): SkyPathLine {
  const n = Math.min(path.azDeg.length, path.elDeg.length)
  const points: Vec3[] = []
  const visible: boolean[] = []
  if (n === 0) return { points, visible }
  const stride = Math.max(1, Math.ceil(n / Math.max(2, maxPoints)))
  const push = (i: number) => {
    const [x, y, z] = azElToUnitVector(path.azDeg[i], path.elDeg[i])
    points.push([x * radius, y * radius, z * radius])
    visible.push(path.visible ? Boolean(path.visible[i]) : true)
  }
  for (let i = 0; i < n; i += stride) push(i)
  if ((n - 1) % stride !== 0) push(n - 1)
  return { points, visible }
}
