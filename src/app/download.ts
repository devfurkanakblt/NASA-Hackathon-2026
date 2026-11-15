/** Saves text as a file in the browser (no network). */
import type { SiteData } from '../data/contract.ts'
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { scenarioExport, toCsv } from '../sim/export.ts'

/** `Site01-r36c32_2026-11-15T0000Z_7d.csv`: letters, digits, `-`, `_`, `.` only. */
export function csvFileName(result: ScenarioResult, settings: MissionSettings): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${safe(result.siteId)}_${safe(result.alignedStartUtc.slice(0, 16).replace(/:/g, '') + 'Z')}_${settings.durationDays}d.csv`
}

export function scenarioCsv(data: SiteData, result: ScenarioResult, settings: MissionSettings): string {
  return toCsv(scenarioExport(data, result, settings))
}

export function downloadText(text: string, fileName: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
