import type { BodySeries, HorizonDoc } from '../data/contract.ts'

/**
 * Terrain-horizon elevation at an azimuth: circular linear interpolation of the profile.
 * This is `horizonAt` from docs/data-contract.md — the one visibility rule of the project.
 */
export function horizonAt(horizon: Pick<HorizonDoc, 'azStepDeg' | 'elevDeg'>, azDeg: number): number {
  const n = horizon.elevDeg.length
  const x = (((azDeg % 360) + 360) % 360) / horizon.azStepDeg
  const i0 = Math.floor(x) % n
  const i1 = (i0 + 1) % n
  const f = x - Math.floor(x)
  return horizon.elevDeg[i0] * (1 - f) + horizon.elevDeg[i1] * f
}

/**
 * Height of the body's centre above the terrain horizon, per sample, for `count` samples
 * starting at `startIndex`. The body is visible where this is positive.
 */
export function marginSeries(series: BodySeries, horizon: Pick<HorizonDoc, 'azStepDeg' | 'elevDeg'>, startIndex: number, count: number): Float64Array {
  const out = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    const i = startIndex + k
    out[k] = series.elDeg[i] - horizonAt(horizon, series.azDeg[i])
  }
  return out
}

/** A stretch of time during which a body (or both bodies) is visible. */
export interface VisibilityWindow {
  /** First visible sample and one past the last visible sample (`[startIndex, endIndex)`). */
  startIndex: number
  endIndex: number
  /**
   * Rise and set in seconds from the first sample, with the crossing placed between the two
   * neighbouring samples by linear interpolation of the margin.
   */
  startS: number
  endS: number
  /** Already visible at the first sample / still visible at the last one. */
  openAtStart: boolean
  openAtEnd: boolean
}

/** Position of the zero crossing between two samples, as a fraction of the step. */
function crossing(a: number, b: number): number {
  return a / (a - b)
}

/** Visibility windows from a margin series (visible where margin > 0). */
export function windowsFromMargins(margin: ArrayLike<number>, stepS: number): VisibilityWindow[] {
  const n = margin.length
  const windows: VisibilityWindow[] = []
  if (n === 0) return windows
  let open: { startIndex: number; startS: number; openAtStart: boolean } | null = margin[0] > 0 ? { startIndex: 0, startS: 0, openAtStart: true } : null
  for (let i = 0; i < n - 1; i++) {
    const a = margin[i]
    const b = margin[i + 1]
    if (a > 0 === b > 0) continue
    const atS = (i + crossing(a, b)) * stepS
    if (b > 0) {
      open = { startIndex: i + 1, startS: atS, openAtStart: false }
    } else if (open) {
      windows.push({ ...open, endIndex: i + 1, endS: atS, openAtEnd: false })
      open = null
    }
  }
  if (open) windows.push({ ...open, endIndex: n, endS: (n - 1) * stepS, openAtEnd: true })
  return windows
}

/** Fraction of each step (between sample `i` and `i + 1`) during which the body is visible. */
export function stepFractions(margin: ArrayLike<number>): Float64Array {
  const out = new Float64Array(Math.max(0, margin.length - 1))
  for (let i = 0; i < out.length; i++) {
    const a = margin[i]
    const b = margin[i + 1]
    if (a > 0 && b > 0) out[i] = 1
    else if (a > 0) out[i] = crossing(a, b)
    else if (b > 0) out[i] = 1 - crossing(a, b)
  }
  return out
}

/** Windows during which both inputs are open (e.g. Sun and Earth visible together). */
export function intersectWindows(a: VisibilityWindow[], b: VisibilityWindow[]): VisibilityWindow[] {
  const out: VisibilityWindow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const first = a[i].startS >= b[j].startS ? a[i] : b[j]
    const last = a[i].endS <= b[j].endS ? a[i] : b[j]
    if (first.startS < last.endS) {
      out.push({
        startIndex: Math.max(a[i].startIndex, b[j].startIndex),
        endIndex: Math.min(a[i].endIndex, b[j].endIndex),
        startS: first.startS,
        endS: last.endS,
        openAtStart: a[i].openAtStart && b[j].openAtStart,
        openAtEnd: a[i].openAtEnd && b[j].openAtEnd,
      })
    }
    if (a[i].endS < b[j].endS) i++
    else j++
  }
  return out
}

export function totalDurationS(windows: VisibilityWindow[]): number {
  return windows.reduce((sum, w) => sum + (w.endS - w.startS), 0)
}

/** Longest stretch without visibility within `[0, totalS]`, including before the first and after the last window. */
export function longestGapS(windows: VisibilityWindow[], totalS: number): number {
  let longest = 0
  let cursor = 0
  for (const w of windows) {
    longest = Math.max(longest, w.startS - cursor)
    cursor = w.endS
  }
  return Math.max(longest, totalS - cursor)
}

export interface Transition {
  /** `set`: the body is visible now and will be hidden; `rise`: hidden now, will appear. */
  kind: 'rise' | 'set'
  /** Seconds from the first sample. */
  atS: number
}

/**
 * The next rise or set after time `tS`, or `null` when nothing changes before the end of the
 * period (the body stays up, or stays down, for the rest of it).
 */
export function nextTransition(windows: VisibilityWindow[], tS: number): Transition | null {
  for (const w of windows) {
    if (tS < w.startS) return { kind: 'rise', atS: w.startS }
    if (tS < w.endS) return w.openAtEnd ? null : { kind: 'set', atS: w.endS }
  }
  return null
}
