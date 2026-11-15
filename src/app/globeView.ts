/** Southern-hemisphere globe: what is drawn and where the overview camera may go. */
/** Northernmost latitude drawn: the southern hemisphere plus a small margin so points near the equator (Apollo 12, 3.0° S) sit well inside the rim. */
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


/**
 * Where the i-th place label sits relative to its pin (px). Rows alternate above and below the
 * pole cluster, so labels stay inside the globe view as the catalogue grows.
 * Desktop: three labels per row, 190 px apart; mobile: two per row.
 */
export function labelOffset(i: number): { x: number; y: number; mobileX: number; mobileY: number } {
  const row = Math.floor(i / 3)
  const mobileRow = Math.floor(i / 2)
  const side = (r: number) => (r % 2 === 0 ? -1 : 1)
  return {
    x: (i % 3 - 1) * 190,
    y: side(row) * (45 + Math.floor(row / 2) * 50),
    mobileX: (i % 2 ? 1 : -1) * 79,
    mobileY: side(mobileRow) * (40 + Math.floor(mobileRow / 2) * 49),
  }
}

/** Space kept free around the globe frame (px): the bottom holds the hint and image credit. */
export const LABEL_FRAME_PAD = { side: 8, top: 8, bottom: 64 }

/**
 * Extra shift (px) that keeps a label box inside the globe frame. Places near the rim of the
 * southern view (Apollo 12, Chang'e-6) would otherwise push their label off the edge.
 * anchor: the pin on screen; pin: the label's usual offset from it; label/frame: sizes.
 */
export function keepLabelInFrame(anchor: { x: number; y: number }, pin: { x: number; y: number },
  label: { w: number; h: number }, frame: { w: number; h: number }, pad = LABEL_FRAME_PAD): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
  const cx = anchor.x + pin.x, cy = anchor.y + pin.y
  return {
    x: clamp(cx, pad.side + label.w / 2, frame.w - pad.side - label.w / 2) - cx,
    y: clamp(cy, pad.top + label.h / 2, frame.h - pad.bottom - label.h / 2) - cy,
  }
}
