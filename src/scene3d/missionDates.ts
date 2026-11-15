/** Picker limits remain safe while invalid shared settings are being corrected. */
export function latestMissionStartUtc(endUtc: string, durationDays: number): string | null {
  const end = Date.parse(endUtc)
  if (!Number.isFinite(end)) return null
  // This bounds the picker only; validateSettings still rejects the original invalid value.
  if (!Number.isFinite(durationDays) || durationDays < 1) return null
  const start = new Date(end - durationDays * 86400000)
  return Number.isFinite(start.getTime()) ? start.toISOString() : null
}
