/** Scene distances in units of `sceneHalfExtent`: sky sphere and the reference sphere's outer edge. */
export const SKY_RADIUS = 75
export const REFERENCE_SPHERE_RADIUS = SKY_RADIUS - 5

/**
 * Half-size the far scene scales with: the near patch, or 1/48 of the regional mesh when that is
 * larger. For the usual 10 km patch inside a 240 km regional mesh both are 5 km. A narrower near
 * patch (IM-1's is 4 km) would otherwise put the sky and the reference sphere inside the regional
 * mesh, and the 3D view refused to build ("Reference sphere radius must surround measured terrain").
 */
export function sceneHalfExtent(nearHalfM: number, farSizeM?: number): number {
  return Math.max(nearHalfM, (farSizeM ?? 0) / 48)
}
