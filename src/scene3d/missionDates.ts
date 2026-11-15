import { MAX_DURATION_DAYS, MIN_DURATION_DAYS } from '../sim/evaluate.ts'

/** Picker limits remain safe while invalid shared settings are being corrected. */
export function latestMissionStartUtc(endUtc: string, durationDays: number): string | null {
  const end = Date.parse(endUtc)
  if (!Number.isFinite(end)) return null
  // This bounds the picker only; validateSettings still rejects the original invalid value.
  const days = Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Number.isFinite(durationDays) ? durationDays : 1))
  return new Date(end - days * 86400000).toISOString()
}
