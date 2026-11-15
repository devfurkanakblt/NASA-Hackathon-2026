/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EphemerisDoc, HorizonDoc, SeasonDoc, SiteData, SitesDoc } from '../data/contract.ts'
import { parseYear, type ExtendedHeader } from '../data/extended.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { dailyVisibility, nextEvent } from './events.ts'
import { EXPORT_COLUMNS, scenarioExport, toCsv } from './export.ts'
import { marginSeries, nextTransition, windowsFromMargins } from './visibility.ts'

const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const readBin = (path: string): ArrayBuffer => {
  const b = readFileSync(DATA_DIR + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json')
const yearOf = (id: string): EphemerisDoc => parseYear(id, read<ExtendedHeader>(`${id}/extended.json`), readBin(`${id}/year.bin`))
const data = (id: string): SiteData => ({ site: sites.sites.find((s) => s.id === id)!, ephemeris: read(`${id}/ephemeris.json`), horizon: read(`${id}/horizon.json`) })

describe('nextEvent', () => {
  it('Site07: no sunset in the two-month data is "not within the available data", and the year series finds the real one', () => {
    const d = data('Site07')
    const two = nextEvent(d.ephemeris, d.horizon, 'sun', '2026-11-15T00:00:00Z')
    expect(two.kind).toBe('none')
    if (two.kind === 'none') {
      expect(two.visible).toBe(true)
      expect(two.message).toBe('No sunset within the available data (until 2027-01-01T00:00 UTC).')
    }
    // the 7-day mission has no set inside it either: the mission end is not a sunset
    const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(nextTransition(r.sunWindows, 0)).toBeNull()
    const year = nextEvent(yearOf('Site07'), d.horizon, 'sun', '2026-11-22T00:00:00Z')
    expect(year.kind).toBe('set')
    if (year.kind === 'set') expect(Date.parse(year.utc)).toBeGreaterThan(Date.parse('2027-01-01T00:00:00Z'))
  })

  it('Site04: Earth never rises in the two months', () => {
    const d = data('Site04')
    const e = nextEvent(d.ephemeris, d.horizon, 'earth', '2026-11-15T00:00:00Z')
    expect(e).toMatchObject({ kind: 'none', visible: false })
    if (e.kind === 'none') expect(e.message).toMatch(/^No Earthrise within the available data/)
  })

  it('agrees with the engine windows (linear interpolation) and is strictly after the time', () => {
    const d = data('Site01')
    const m = marginSeries(d.ephemeris.sun, d.horizon, 0, d.ephemeris.count)
    const w = windowsFromMargins(m, d.ephemeris.stepS)
    const t0 = Date.parse(d.ephemeris.startUtc)
    const firstEnd = w.find((x) => !x.openAtEnd)!.endS
    const e = nextEvent(d.ephemeris, d.horizon, 'sun', d.ephemeris.startUtc)
    const expected = w[0].openAtStart ? firstEnd : w[0].startS
    expect(e.kind === 'set' || e.kind === 'rise').toBe(true)
    if (e.kind === 'set' || e.kind === 'rise') {
      expect(Math.abs(Date.parse(e.utc) - (t0 + expected * 1000))).toBeLessThanOrEqual(1000)
      const again = nextEvent(d.ephemeris, d.horizon, 'sun', e.utc)
      expect(again.kind === 'none' || Date.parse((again as { utc: string }).utc) > Date.parse(e.utc)).toBe(true)
    }
  })

  it('outside the data is said, not guessed', () => {
    const d = data('Site01')
    expect(nextEvent(d.ephemeris, d.horizon, 'sun', '2027-03-01T00:00:00Z').kind).toBe('outside')
  })
})

describe('dailyVisibility', () => {
  it('365 whole UTC days; their mean equals the yearly share without the last sample', () => {
    const hz = read<HorizonDoc>('Site01/horizon.json')
    const days = dailyVisibility(yearOf('Site01'), hz)
    expect(days).toHaveLength(365)
    expect(days[0].day).toBe('2026-11-01')
    expect(days.at(-1)!.day).toBe('2027-10-31')
    const mean = days.reduce((s, d) => s + d.sunPct, 0) / days.length
    const season = read<SeasonDoc>('Site01/season.json')
    expect(Math.abs(mean - season.year.sunPct)).toBeLessThan(0.05)
    for (const d of days) expect(d.bothPct).toBeLessThanOrEqual(Math.min(d.sunPct, d.earthPct))
  })
})

describe('scenario export', () => {
  it('carries place, UTC, units, settings, source and model limits with every sample', () => {
    const d = data('Site04R')
    const r = evaluateScenario(d, '2026-11-15T00:04:00Z', DEFAULT_SETTINGS)
    const exp = scenarioExport(d, r, DEFAULT_SETTINGS)
    expect(exp.rows).toHaveLength(r.count)
    expect(exp.rows[0]).toHaveLength(EXPORT_COLUMNS.length)
    expect(exp.meta.requestedStartUtc).toBe('2026-11-15T00:04:00Z')
    expect(exp.meta.alignedStartUtc).toBe('2026-11-15T00:00:00Z')
    expect(exp.meta.settings).toEqual(DEFAULT_SETTINGS)
    expect(exp.meta.derivation).toBe(d.site.derivation)
    const csv = toCsv(exp)
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^# Lunar Landing Site Navigator scenario export, schema 1/)
    expect(csv).toMatch(/# setting\.batteryCapacityWh: 5000/)
    expect(csv).toMatch(/# ephemeris_source: /)
    expect(csv).toMatch(/# model_note: Earth view is line of sight only/)
    const header = lines.find((l) => !l.startsWith('#'))!
    expect(header).toBe('Time (UTC) (ISO 8601),Hours from mission start (h),"Sun centre above terrain horizon (1 = yes, 0 = no)","Earth centre above terrain horizon (1 = yes, 0 = no)",Share of solar disk above horizon (0–1),Panel output (W),Demand (W),Battery charge (Wh),Battery charge (%)')
    expect(lines.filter((l) => !l.startsWith('#'))).toHaveLength(r.count + 1)
    expect(lines.at(-1)!.startsWith('2026-11-22T00:00:00Z,168,')).toBe(true)
  })
})
