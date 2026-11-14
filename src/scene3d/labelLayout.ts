export interface LabelBox { x: number; y: number; w: number; h: number }

/** Find an in-bounds label position, preferring a short move over an overlap. */
export function placeLabel(preferred: LabelBox, width: number, height: number, placed: LabelBox[], margin = 4): LabelBox {
  const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), v))
  const fit = (x: number, y: number): LabelBox => ({ ...preferred,
    x: clamp(x, preferred.w / 2 + margin, width - preferred.w / 2 - margin),
    y: clamp(y, preferred.h / 2 + margin, height - preferred.h / 2 - margin) })
  const first = fit(preferred.x, preferred.y)
  const candidates = [first]
  for (const other of placed) {
    candidates.push(fit(first.x, other.y - (other.h + first.h) / 2 - 3),
      fit(first.x, other.y + (other.h + first.h) / 2 + 3),
      fit(other.x - (other.w + first.w) / 2 - 5, first.y),
      fit(other.x + (other.w + first.w) / 2 + 5, first.y))
  }
  const overlaps = (a: LabelBox, b: LabelBox) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + 2
  candidates.sort((a, b) => (a.x - first.x) ** 2 + (a.y - first.y) ** 2 - ((b.x - first.x) ** 2 + (b.y - first.y) ** 2))
  return candidates.find((candidate) => placed.every((other) => !overlaps(candidate, other))) ?? first
}
