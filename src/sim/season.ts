/**
 * Monthly / yearly visibility summary of any point from its own ephemeris and horizon: the
 * TypeScript twin of `preprocess/season.py` (same samples, same rules, same rounding). For a
 * regional map cell this is the cell's own summary — the catalogue centre's `season.json`
 * is never substituted.
 */
import type { EphemerisDoc, HorizonDoc, SeasonDoc, SeasonSummary } from '../data/contract.ts'
import { horizonAt, sunDiskFraction } from './visibility.ts'

/** End of the two-month main period (ephemeris.json), inclusive — as `C.STOP_UTC` in Python. */
export const MAIN_PERIOD_END_UTC = '2027-01-01T00:00:00Z'

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

const round = (v: number, d: number) => {
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Longest run of samples where the body is hidden (`mask[i] === 0`), as samples × step. */
function longestHiddenS(mask: Uint8Array, from: number, to: number, stepS: number): number {
  let best = 0
  let run = 0
  for (let i = from; i < to; i++) {
    run = mask[i] ? 0 : run + 1
    if (run > best) best = run
  }
  return best * stepS
}

interface Masks {
  sun: Uint8Array
  earth: Uint8Array
  disk: Float64Array
}

function masks(eph: EphemerisDoc, horizon: HorizonDoc): Masks {
  const n = eph.count
  const sun = new Uint8Array(n)
  const earth = new Uint8Array(n)
  const disk = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const sm = eph.sun.elDeg[i] - horizonAt(horizon, eph.sun.azDeg[i])
    const em = eph.earth.elDeg[i] - horizonAt(horizon, eph.earth.azDeg[i])
    if (!Number.isFinite(sm) || !Number.isFinite(em)) throw new RangeError(`${eph.siteId}: non-finite ephemeris or horizon value at sample ${i}.`)
    sun[i] = sm > 0 ? 1 : 0
    earth[i] = em > 0 ? 1 : 0
    disk[i] = sunDiskFraction(sm, eph.sun.distanceM[i])
  }
  return { sun, earth, disk }
}

function stats(eph: EphemerisDoc, m: Masks, from: number, to: number): SeasonSummary {
  const n = to - from
  let s = 0
  let e = 0
  let both = 0
  let disk = 0
  let sunMax = -Infinity
  let sunMin = Infinity
  let earthMax = -Infinity
  for (let i = from; i < to; i++) {
    s += m.sun[i]
    e += m.earth[i]
    both += m.sun[i] & m.earth[i]
    disk += m.disk[i]
    sunMax = Math.max(sunMax, eph.sun.elDeg[i])
    sunMin = Math.min(sunMin, eph.sun.elDeg[i])
    earthMax = Math.max(earthMax, eph.earth.elDeg[i])
  }
  return {
    samples: n,
    sunPct: round((100 * s) / n, 2),
    earthPct: round((100 * e) / n, 2),
    bothPct: round((100 * both) / n, 2),
    sunDiskFractionMean: round(disk / n, 4),
    longestNoSunS: longestHiddenS(m.sun, from, to, eph.stepS),
    longestNoEarthS: longestHiddenS(m.earth, from, to, eph.stepS),
    sunElMaxDeg: round(sunMax, 3),
    sunElMinDeg: round(sunMin, 3),
    earthElMaxDeg: round(earthMax, 3),
  }
}

/**
 * Season table of a point. Months are calendar months in UTC, `[start, end)` without the end
 * sample; `year` uses every sample; `mainPeriod` the samples of the two-month series
 * (start … 1 Jan 2027 inclusive). Rows are only made for months fully inside the series.
 */
export function seasonFromSeries(eph: EphemerisDoc, horizon: HorizonDoc): SeasonDoc {
  if (!(eph.count > 1) || !(eph.stepS > 0)) throw new RangeError(`${eph.siteId}: ephemeris too short for a season summary.`)
  const m = masks(eph, horizon)
  const t0 = Date.parse(eph.startUtc)
  const stepMs = eph.stepS * 1000
  const endMs = t0 + (eph.count - 1) * stepMs
  const indexOf = (ms: number) => Math.floor((ms - t0) / stepMs)

  const months: SeasonDoc['months'] = []
  const start = new Date(t0)
  let y = start.getUTCFullYear()
  let mo = start.getUTCMonth()
  for (;;) {
    const a = Date.UTC(y, mo, 1)
    const b = Date.UTC(mo === 11 ? y + 1 : y, (mo + 1) % 12, 1)
    if (b > endMs) break
    if (a >= t0) {
      const i0 = indexOf(a)
      const i1 = indexOf(b)
      months.push({ month: `${y}-${String(mo + 1).padStart(2, '0')}`, startIndex: i0, endIndex: i1, ...stats(eph, m, i0, i1) })
    }
    y = mo === 11 ? y + 1 : y
    mo = (mo + 1) % 12
  }

  const mainEnd = Math.min(endMs, Date.parse(MAIN_PERIOD_END_UTC))
  const nMain = indexOf(mainEnd) + 1
  return {
    version: 1,
    siteId: eph.siteId,
    source: eph.source,
    coverage: { startUtc: eph.startUtc, endUtc: iso(endMs), stepS: eph.stepS, count: eph.count },
    year: stats(eph, m, 0, eph.count),
    mainPeriod: { startUtc: eph.startUtc, endUtc: iso(mainEnd), ...stats(eph, m, 0, nMain) },
    months,
  }
}
