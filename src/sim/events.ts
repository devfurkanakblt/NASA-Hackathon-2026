/**
 * Events over the whole loaded series, not only the mission window:
 *
 * - `nextEvent`: the next real sunset / Earthset (or rise) after a UTC time. A mission end is not
 *   a set; when nothing changes before the data ends the answer says so ("no set within the
 *   available data, until …") instead of claiming the body never sets.
 * - `dailyVisibility`: per-UTC-day Sun / Earth / both percentages of one point, for the optional
 *   year calendar heat map.
 *
 * Margins are cached per ephemeris + horizon object, so repeated countdown queries are cheap.
 */
import type { EphemerisDoc, HorizonDoc } from '../data/contract.ts'
import { DataError } from './evaluate.ts'
import { marginSeries } from './visibility.ts'

type Body = 'sun' | 'earth'

const marginCache = new WeakMap<EphemerisDoc, WeakMap<HorizonDoc, Partial<Record<Body, Float64Array>>>>()

function margins(eph: EphemerisDoc, horizon: HorizonDoc, body: Body): Float64Array {
  let byHz = marginCache.get(eph)
  if (!byHz) marginCache.set(eph, (byHz = new WeakMap()))
  let entry = byHz.get(horizon)
  if (!entry) byHz.set(horizon, (entry = {}))
  let m = entry[body]
  if (!m) {
    m = marginSeries(eph[body], horizon, 0, eph.count)
    if (!m.every(Number.isFinite)) throw new DataError(`${eph.siteId}: the ${body} series or the horizon has a non-finite value.`)
    entry[body] = m
  }
  return m
}

/** To the second; event times round up so a query at a returned time finds the next event. */
const iso = (ms: number) => new Date(Math.ceil(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')

export type NextEvent =
  | { kind: 'rise' | 'set'; utc: string; inS: number }
  | { kind: 'none'; visible: boolean; dataEndUtc: string; message: string }
  | { kind: 'outside'; message: string }

const NAMES: Record<Body, { set: string; rise: string; name: string }> = {
  sun: { set: 'sunset', rise: 'sunrise', name: 'Sun' },
  earth: { set: 'Earthset', rise: 'Earthrise', name: 'Earth' },
}

/**
 * Next rise or set of `body` strictly after `fromUtc`, with the crossing placed by linear
 * interpolation of the margin between samples (the engine's rule).
 */
export function nextEvent(eph: EphemerisDoc, horizon: HorizonDoc, body: Body, fromUtc: string): NextEvent {
  const t0 = Date.parse(eph.startUtc)
  const stepMs = eph.stepS * 1000
  const t = Date.parse(fromUtc)
  const endMs = t0 + (eph.count - 1) * stepMs
  if (!Number.isFinite(t) || t < t0 || t > endMs) return { kind: 'outside', message: `${fromUtc} is outside the computed period (${iso(t0).slice(0, 16)} to ${iso(endMs).slice(0, 16)} UTC).` }
  const m = margins(eph, horizon, body)
  const x = (t - t0) / stepMs
  const i0 = Math.floor(x)
  // state at t (interpolated)
  const f = x - i0
  const here = i0 + 1 < eph.count ? m[i0] * (1 - f) + m[i0 + 1] * f : m[i0]
  const visible = here > 0
  for (let i = i0; i < eph.count - 1; i++) {
    const a = m[i]
    const b = m[i + 1]
    if (a > 0 === b > 0) continue
    const at = t0 + (i + a / (a - b)) * stepMs
    if (at <= t) continue
    return { kind: b > 0 ? 'rise' : 'set', utc: iso(at), inS: (at - t) / 1000 }
  }
  const n = NAMES[body]
  return {
    kind: 'none',
    visible,
    dataEndUtc: iso(endMs),
    message: visible ? `No ${n.set} within the available data (until ${iso(endMs).slice(0, 16)} UTC).` : `No ${n.rise} within the available data (until ${iso(endMs).slice(0, 16)} UTC).`,
  }
}

export interface DayVisibility {
  /** UTC date, YYYY-MM-DD. */
  day: string
  samples: number
  sunPct: number
  earthPct: number
  bothPct: number
}

/** Per UTC day `[00:00, 24:00)`, share of samples with the Sun / Earth / both above the horizon. Only whole days. */
export function dailyVisibility(eph: EphemerisDoc, horizon: HorizonDoc): DayVisibility[] {
  const sun = margins(eph, horizon, 'sun')
  const earth = margins(eph, horizon, 'earth')
  const t0 = Date.parse(eph.startUtc)
  const stepMs = eph.stepS * 1000
  const perDay = 86400000 / stepMs
  const out: DayVisibility[] = []
  const firstDay = Math.ceil(t0 / 86400000) * 86400000
  for (let d = firstDay; ; d += 86400000) {
    const i0 = (d - t0) / stepMs
    const i1 = i0 + perDay
    if (!Number.isInteger(i0) || i1 > eph.count) break
    let s = 0
    let e = 0
    let both = 0
    for (let i = i0; i < i1; i++) {
      const sv = sun[i] > 0
      const ev = earth[i] > 0
      s += sv ? 1 : 0
      e += ev ? 1 : 0
      both += sv && ev ? 1 : 0
    }
    const pct = (v: number) => Math.round((10000 * v) / perDay) / 100
    out.push({ day: new Date(d).toISOString().slice(0, 10), samples: perDay, sunPct: pct(s), earthPct: pct(e), bothPct: pct(both) })
  }
  return out
}
