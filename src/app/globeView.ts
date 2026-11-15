/** Southern-hemisphere globe: what is drawn and where the overview camera may go. */
/** Northernmost latitude drawn: the southern hemisphere plus a margin that keeps Apollo 11 (0.67° N) on the surface. */
export const GLOBE_NORTH_EDGE_DEG = 3
/** Northernmost latitude the camera may look down from while viewing the whole globe. */
export const GLOBE_CAMERA_MAX_LAT_DEG = -35
/** Closer than this (globe radii) the camera is inspecting one place and is not limited. */
export const CLOSE_VIEW_DISTANCE = 1.15

/** Latitude-limited camera position for the whole-globe view; unchanged when already south enough. */
export function southernCameraPosition([x, y, z]: [number, number, number], maxLatDeg = GLOBE_CAMERA_MAX_LAT_DEG): [number, number, number] {
  const r = Math.hypot(x, y, z)
  if (!(r > CLOSE_VIEW_DISTANCE) || Math.asin(y / r) <= maxLatDeg * Math.PI / 180) return [x, y, z]
  const lat = maxLatDeg * Math.PI / 180
  const horizontal = Math.hypot(x, z)
  const lonX = horizontal > 1e-9 ? x / horizontal : 1
  const lonZ = horizontal > 1e-9 ? z / horizontal : 0
  return [r * Math.cos(lat) * lonX, r * Math.sin(lat), r * Math.cos(lat) * lonZ]
}

