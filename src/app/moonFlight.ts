import { Quaternion, Vector3 } from 'three'

type Coordinate = { latDeg: number; lonDeg: number }

export function moonPosition(site: Coordinate) {
  const lat = site.latDeg * Math.PI / 180
  const lon = site.lonDeg * Math.PI / 180
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
}

export function createMoonRoute(from: Coordinate, to: Coordinate) {
  const start = moonPosition(from)
  return { start, rotation: new Quaternion().setFromUnitVectors(start, moonPosition(to)) }
}

/** Zoom out, follow the minor great-circle arc, then zoom into its centred destination. */
export function sampleMoonRoute(route: ReturnType<typeof createMoonRoute>, progress: number) {
  const t = Math.max(0, Math.min(1, progress))
  const travel = Math.max(0, Math.min(1, (t - .22) / .56))
  const eased = travel * travel * (3 - 2 * travel)
  const direction = route.start.clone().applyQuaternion(new Quaternion().identity().slerp(route.rotation, eased))
  const distance = t < .22 ? 1.045 + 1.55 * Math.sin(t / .22 * Math.PI / 2)
    : t > .78 ? 1.045 + 1.55 * Math.cos((t - .78) / .22 * Math.PI / 2) : 2.595
  return { direction, distance }
}
