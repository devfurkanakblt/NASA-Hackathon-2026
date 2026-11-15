/** Place globe helpers: where labels sit and how places are grouped in the picker list. */

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

export interface LabelBox { x: number; y: number; w: number; h: number }
/** Prefer an in-frame label position with no overlap; crowded tiny frames minimise overlap. */
export function separateGlobeLabel(anchor: { x: number; y: number }, pin: { x: number; y: number },
  label: { w: number; h: number }, frame: { w: number; h: number }, placed: LabelBox[]): LabelBox {
  const initial = keepLabelInFrame(anchor, pin, label, frame)
  const x = anchor.x + pin.x + initial.x, y = anchor.y + pin.y + initial.y
  const xs = [x, ...placed.flatMap(p => [p.x - (p.w + label.w) / 2 - 6, p.x + (p.w + label.w) / 2 + 6])]
  const ys = [y, ...placed.flatMap(p => [p.y - (p.h + label.h) / 2 - 6, p.y + (p.h + label.h) / 2 + 6])]
  let best = { x, y, ...label }, overlap = Infinity, distance = Infinity
  for (const cx of xs) for (const cy of ys) {
    const shift = keepLabelInFrame({ x: cx, y: cy }, { x: 0, y: 0 }, label, frame)
    const box = { x: cx + shift.x, y: cy + shift.y, ...label }
    const area = placed.reduce((sum, p) => sum + Math.max(0, Math.min(box.x + box.w / 2, p.x + p.w / 2) - Math.max(box.x - box.w / 2, p.x - p.w / 2))
      * Math.max(0, Math.min(box.y + box.h / 2, p.y + p.h / 2) - Math.max(box.y - box.h / 2, p.y - p.h / 2)), 0)
    const d = (box.x - x) ** 2 + (box.y - y) ** 2
    if (area < overlap || (area === overlap && d < distance)) { best = box; overlap = area; distance = d }
  }
  return best
}

/**
 * Extra shift (px) that keeps a label box inside the globe frame. Places near the rim of the
 * visible disc would otherwise push their label off the edge.
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

/**
 * Places for the picker list, in catalogue order: the south-polar places, then the comparison
 * places elsewhere on the Moon (`category: 'contrast'`, the same split the research
 * alternatives use).
 */
export function placeGroups<T extends { category?: string }>(sites: T[]): { id: 'pole' | 'elsewhere'; title: string; sites: T[] }[] {
  const groups = [
    { id: 'pole' as const, title: 'South pole', sites: sites.filter((s) => s.category !== 'contrast') },
    { id: 'elsewhere' as const, title: 'Elsewhere on the Moon, for comparison', sites: sites.filter((s) => s.category === 'contrast') },
  ]
  return groups.filter((g) => g.sites.length > 0)
}
