/**
 * Export schema for one scenario (B builds the CSV / PDF button on it). Everything a reader
 * needs travels with the numbers: place and coordinates, UTC times, units, every setting, the
 * data source, the horizon resolution and the model limits. Numbers keep SI or the unit named
 * in the column; no rounding beyond what the engine produced, except W / Wh to 3 decimals.
 */
import type { SiteData } from '../data/contract.ts'
import { J_PER_WH } from './energy.ts'
import { sampleUtc } from './evaluate.ts'
import type { MissionSettings, ScenarioResult } from './evaluate.ts'

export const EXPORT_SCHEMA_VERSION = 1

export interface ExportColumn {
  key: string
  label: string
  unit: string
}

export interface ScenarioExport {
  schemaVersion: number
  meta: {
    siteId: string
    siteName: string
    label: string
    latDeg: number
    lonDeg: number
    observerHeightM: number
    requestedStartUtc: string
    alignedStartUtc: string
    durationS: number
    stepS: number
    horizon: string
    ephemerisSource: string
    coordSource: string
    derivation: string | null
    warnings: string[]
    settings: MissionSettings
    summary: ScenarioResult['summary']
    modelNotes: string[]
    timeConvention: string
  }
  columns: ExportColumn[]
  rows: (string | number)[][]
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'utc', label: 'Time (UTC)', unit: 'ISO 8601' },
  { key: 'hours', label: 'Hours from mission start', unit: 'h' },
  { key: 'sunVisible', label: 'Sun centre above terrain horizon', unit: '1 = yes, 0 = no' },
  { key: 'earthVisible', label: 'Earth centre above terrain horizon', unit: '1 = yes, 0 = no' },
  { key: 'sunDiskFraction', label: 'Share of solar disk above horizon', unit: '0–1' },
  { key: 'generationW', label: 'Panel output', unit: 'W' },
  { key: 'loadW', label: 'Demand', unit: 'W' },
  { key: 'socWh', label: 'Battery charge', unit: 'Wh' },
  { key: 'socPct', label: 'Battery charge', unit: '%' },
]

const r3 = (v: number) => Math.round(v * 1000) / 1000

export function scenarioExport(data: SiteData, result: ScenarioResult, settings: MissionSettings): ScenarioExport {
  const s = data.site
  const hz = data.horizon
  const rows: (string | number)[][] = []
  for (let k = 0; k < result.count; k++) {
    rows.push([
      sampleUtc(result, k),
      r3((k * result.stepS) / 3600),
      result.sunVisible[k] ? 1 : 0,
      result.earthVisible[k] ? 1 : 0,
      r3(result.sunDiskFraction[k]),
      r3(result.generationW[k]),
      r3(result.loadW[k]),
      r3(result.socJ[k] / J_PER_WH),
      r3((100 * result.socJ[k]) / result.batteryCapacityJ),
    ])
  }
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    meta: {
      siteId: s.id,
      siteName: s.name,
      label: s.label,
      latDeg: s.latDeg,
      lonDeg: s.lonDeg,
      observerHeightM: s.observerHeightM,
      requestedStartUtc: result.startUtc,
      alignedStartUtc: result.alignedStartUtc,
      durationS: result.durationS,
      stepS: result.stepS,
      horizon: `${hz.azStepDeg}° azimuth step, ${hz.count} directions${hz.distanceM ? '' : ' (no ridge distances)'}`,
      ephemerisSource: result.model.ephemerisSource,
      coordSource: s.coordSource ?? '',
      derivation: s.derivation ?? null,
      warnings: s.warnings ?? [],
      settings: { ...settings },
      summary: { ...result.summary },
      modelNotes: [...result.model.notes, 'Research regions, not certified landing sites.'],
      timeConvention: 'All times UTC. Azimuth clockwise from north; elevation above the local horizontal plane.',
    },
    columns: EXPORT_COLUMNS,
    rows,
  }
}

const csvCell = (v: string | number) => {
  const t = String(v)
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/**
 * CSV text: `#`-prefixed metadata lines (key: value, settings and model notes one per line),
 * then a header row "label (unit)" and one row per sample.
 */
export function toCsv(exp: ScenarioExport): string {
  const m = exp.meta
  const lines: string[] = [`# Lunar Landing Site Navigator scenario export, schema ${exp.schemaVersion}`]
  const meta: [string, unknown][] = [
    ['site', `${m.siteName} (${m.siteId})`],
    ['label', m.label],
    ['latitude_deg', m.latDeg],
    ['longitude_deg', m.lonDeg],
    ['observer_height_m', m.observerHeightM],
    ['requested_start_utc', m.requestedStartUtc],
    ['start_utc', m.alignedStartUtc],
    ['duration_s', m.durationS],
    ['step_s', m.stepS],
    ['horizon', m.horizon],
    ['ephemeris_source', m.ephemerisSource],
    ['coordinate_source', m.coordSource],
    ['derivation', m.derivation ?? ''],
    ...m.warnings.map((w): [string, unknown] => ['warning', w]),
    ...Object.entries(m.settings).map(([k, v]): [string, unknown] => [`setting.${k}`, v]),
    ...Object.entries(m.summary).map(([k, v]): [string, unknown] => [`summary.${k}`, v]),
    ...m.modelNotes.map((n): [string, unknown] => ['model_note', n]),
    ['time_convention', m.timeConvention],
  ]
  for (const [k, v] of meta) lines.push(`# ${k}: ${String(v ?? '').replace(/[\r\n]+/g, ' ')}`)
  lines.push(exp.columns.map((c) => csvCell(`${c.label} (${c.unit})`)).join(','))
  for (const row of exp.rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\n') + '\n'
}
