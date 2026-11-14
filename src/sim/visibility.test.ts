import { describe, expect, it } from 'vitest'
import { horizonAt, intersectWindows, longestGapS, marginSeries, nextTransition, stepFractions, sunAngularRadiusDeg, sunDiskFraction, totalDurationS, windowsFromMargins } from './visibility.ts'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)
const STEP = 600

describe('horizonAt', () => {
  const horizon = { azStepDeg: 0.1, elevDeg: Array.from({ length: 3600 }, (_, i) => i) }

  it('interpolates between samples and wraps 359.9° → 0°', () => {
    close(horizonAt(horizon, 12.3), 123, 1e-6)
    close(horizonAt(horizon, 12.35), 123.5, 1e-6)
    close(horizonAt(horizon, 359.95), 3599 / 2, 1e-6)
    close(horizonAt(horizon, -0.05), 3599 / 2, 1e-6)
    close(horizonAt(horizon, 360), 0, 1e-6)
    close(horizonAt(horizon, 720.3), 3, 1e-6)
  })
})

describe('marginSeries', () => {
  it('is elevation minus the terrain horizon at the body azimuth', () => {
    const horizon = { azStepDeg: 90, elevDeg: [1, 2, 3, 4] }
    const series = { azDeg: [0, 90, 135, 359], elDeg: [1.5, 1.5, 1.5, 1.5], distanceM: [1, 1, 1, 1] }
    const m = marginSeries(series, horizon, 1, 3)
    close(m[0], 1.5 - 2)
    close(m[1], 1.5 - 2.5)
    close(m[2], 1.5 - (4 + (1 - 4) * (89 / 90)))
  })
})

describe('windowsFromMargins', () => {
  it('finds a window and places rise and set between the samples', () => {
    //            0    1    2    3    4    5
    const margin = [-1, -1, 1, 3, 1, -3]
    const [w, ...rest] = windowsFromMargins(margin, STEP)
    expect(rest.length).toBe(0)
    expect([w.startIndex, w.endIndex, w.openAtStart, w.openAtEnd]).toEqual([2, 5, false, false])
    close(w.startS, 1.5 * STEP)
    close(w.endS, 4.25 * STEP)
  })

  it('handles a body that never rises and one that never sets', () => {
    expect(windowsFromMargins([-1, -2, -1], STEP)).toEqual([])
    expect(windowsFromMargins([1, 2, 1], STEP)).toEqual([{ startIndex: 0, endIndex: 3, startS: 0, endS: 2 * STEP, openAtStart: true, openAtEnd: true }])
  })

  it('keeps a window that is still open at the end of the data', () => {
    const windows = windowsFromMargins([1, -1, -1, 1, 1], STEP)
    expect(windows.length).toBe(2)
    expect(windows[0].openAtStart).toBe(true)
    close(windows[0].endS, 0.5 * STEP)
    expect([windows[1].startIndex, windows[1].endIndex, windows[1].openAtEnd]).toEqual([3, 5, true])
    close(windows[1].endS, 4 * STEP)
  })

  it('treats a centre exactly on the horizon as not visible', () => {
    expect(windowsFromMargins([0, 0, 0], STEP)).toEqual([])
    const [w] = windowsFromMargins([0, 1, 0], STEP)
    close(w.startS, 0)
    close(w.endS, 2 * STEP)
    expect(w.openAtStart).toBe(false)
  })
})

describe('stepFractions', () => {
  it('agrees with the window durations', () => {
    const margin = [-1, -1, 1, 3, 1, -3, -1, 2, 2]
    const fractions = stepFractions(margin)
    expect(Array.from(fractions)).toEqual([0, 0.5, 1, 1, 0.25, 0, 1 / 3, 1].map((v, i) => (i === 6 ? fractions[6] : v)))
    close(fractions[6], 2 / 3)
    const fromFractions = fractions.reduce((a, b) => a + b, 0) * STEP
    close(fromFractions, totalDurationS(windowsFromMargins(margin, STEP)), 1e-6)
  })
})

describe('window helpers', () => {
  const sun = windowsFromMargins([1, 1, 1, -1, -1, -1, 1, 1, 1, 1, 1], STEP) // up 0–2.5, 5.5–10
  const earth = windowsFromMargins([-1, -1, 1, 1, 1, 1, 1, 1, -1, -1, -1], STEP) // up 1.5–7.5

  it('intersects two sets of windows', () => {
    const both = intersectWindows(sun, earth)
    expect(both.length).toBe(2)
    close(both[0].startS, 1.5 * STEP)
    close(both[0].endS, 2.5 * STEP)
    close(both[1].startS, 5.5 * STEP)
    close(both[1].endS, 7.5 * STEP)
    expect(both.every((w) => !w.openAtStart && !w.openAtEnd)).toBe(true)
    close(totalDurationS(both), 3 * STEP)
    expect(intersectWindows(sun, [])).toEqual([])
  })

  it('finds the longest outage, including before the first and after the last window', () => {
    close(longestGapS(sun, 10 * STEP), 3 * STEP)
    close(longestGapS(earth, 10 * STEP), 2.5 * STEP)
    close(longestGapS([], 10 * STEP), 10 * STEP)
  })

  it('reports the next rise or set, and nothing when the state holds to the end', () => {
    expect(nextTransition(earth, 0)).toEqual({ kind: 'rise', atS: 1.5 * STEP })
    expect(nextTransition(earth, 3 * STEP)).toEqual({ kind: 'set', atS: 7.5 * STEP })
    expect(nextTransition(earth, 8 * STEP)).toBeNull()
    expect(nextTransition(sun, 6 * STEP)).toBeNull() // still up at the end of the data
    expect(nextTransition(sun, 3 * STEP)).toEqual({ kind: 'rise', atS: 5.5 * STEP })
    expect(nextTransition([], 0)).toBeNull()
  })
})

describe('sunDiskFraction', () => {
  const AU = 1.495978707e11

  it('is half the disk with the centre on the horizon and full / none one radius away', () => {
    const r = sunAngularRadiusDeg(AU)
    close(r, 0.2666)
    close(sunDiskFraction(0, AU), 0.5)
    close(sunDiskFraction(r, AU), 1)
    close(sunDiskFraction(-r, AU), 0)
    close(sunDiskFraction(r / 2, AU), 0.75)
    expect(sunDiskFraction(5, AU)).toBe(1)
    expect(sunDiskFraction(-5, AU)).toBe(0)
  })

  it('grows the disk when the Sun is closer', () => {
    close(sunAngularRadiusDeg(0.5 * AU), 2 * 0.2666)
    expect(sunDiskFraction(0.2666, 0.5 * AU)).toBeLessThan(1)
  })
})
