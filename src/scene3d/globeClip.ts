/** Scale the near plane with altitude so coincident photograph shells retain depth precision. */
export function globeNearPlane(distanceFromCentre: number): number {
  if (!Number.isFinite(distanceFromCentre)) return .05
  return Math.max(.00005, Math.min(.05, (distanceFromCentre - 1) * .1))
}
