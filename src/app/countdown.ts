/**
 * "in view, sets in 5 d 20 h" inside the mission; when nothing changes before the mission ends,
 * the next real set / rise after it from the whole loaded series (D's `nextEvent`), or an honest
 * "not within the available data" — never "never sets". The mission end is not a sunset.
 */
import type { EphemerisDoc, HorizonDoc } from '../data/contract.ts'
import { nextEvent } from '../sim/events.ts'
import { nextTransition } from '../sim/visibility.ts'
import type { VisibilityWindow } from '../sim/visibility.ts'
import { fmtDuration, fmtUtc } from './format.ts'

export interface AfterMission {
  ephemeris: EphemerisDoc
  horizon: HorizonDoc
  body: 'sun' | 'earth'
  /** UTC of the mission's last sample. */
  missionEndUtc: string
}

export function countdown(windows: VisibilityWindow[], visibleNow: boolean, tS: number, after?: AfterMission): string {
  const now = visibleNow ? 'in view' : 'hidden'
  const next = nextTransition(windows, tS)
  if (next) return `${now}, ${next.kind === 'set' ? 'sets' : 'rises'} in ${fmtDuration(next.atS - tS)}`
  const rest = `${now} for the rest of the mission`
  if (!after) return rest
  let e
  try {
    e = nextEvent(after.ephemeris, after.horizon, after.body, after.missionEndUtc)
  } catch {
    return rest
  }
  if (e.kind === 'outside') return rest
  const verb = e.kind === 'none' ? (e.visible ? 'set' : 'rise') : e.kind
  if (e.kind === 'none') return `${rest}; no ${verb} within the available data (until ${fmtUtc(e.dataEndUtc)})`
  return `${rest}; next ${verb} after it: ${fmtUtc(e.utc)}`
}
