/**
 * The two mission questions in everyday words, for the result cards: "Will the lander have
 * enough power?" and "Can it talk to Earth?". Same numbers as the comparison table.
 */
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { fmtDuration } from './format.ts'

export interface Verdict {
  ok: boolean
  /** Short answer, e.g. "Enough power". */
  title: string
  /** One sentence with the number behind it. */
  detail: string
}

const dayOf = (s: number) => `day ${Math.floor(s / 86400) + 1}`

export function powerVerdict(result: ScenarioResult, settings: MissionSettings): Verdict {
  const s = result.summary
  const reserve = `${Math.round(settings.reserveFraction * 100)} %`
  if (s.keepsBatteryReserve)
    return { ok: true, title: 'Enough power', detail: `Lowest ${Math.round(s.minSocFraction * 100)} % (reserve ${reserve})` }
  const at = s.firstReserveViolationS ?? 0
  return {
    ok: false,
    title: 'Runs short of power',
    detail: `Below ${reserve} on ${dayOf(at)}${s.unmetEnergyJ > 0 ? ', then empty' : ''}`,
  }
}

export function earthVerdict(result: ScenarioResult, settings: MissionSettings): Verdict {
  const s = result.summary
  const limit = fmtDuration(settings.maxEarthOutageH * 3600)
  if (s.earthVisibleFraction === 0) return { ok: false, title: 'No contact with Earth', detail: 'Always behind terrain' }
  if (s.longestEarthOutageS === 0) return { ok: true, title: 'Always in contact', detail: 'Never out of view' }
  return s.earthOutageWithinLimit
    ? { ok: true, title: 'In contact with Earth', detail: `Longest gap ${fmtDuration(s.longestEarthOutageS)} (max ${limit})` }
    : { ok: false, title: 'Long silences', detail: `Gaps up to ${fmtDuration(s.longestEarthOutageS)} (max ${limit})` }
}
