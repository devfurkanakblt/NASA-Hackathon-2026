/** Picker limits remain safe while invalid shared settings are being corrected. */
export function latestMissionStartUtc(endUtc: string, durationDays: number): string | null {
  const end = Date.parse(endUtc)
  if (!Number.isFinite(end)) return null
  // This bounds the picker only; validateSettings still rejects the original invalid value.
  const days = Math.min(30, Math.max(1, Number.isFinite(durationDays) ? durationDays : 1))
  return new Date(end - days * 86400000).toISOString()
}
