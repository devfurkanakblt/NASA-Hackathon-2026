/// <reference types="node" />
/**
 * C → D: no fixed scenario or mission-length cap any more, so the engine and searches are checked at
 * the edges: 8+ scenarios, 365+ day missions on the multi-year package, the last valid end, a
 * cancelled search; and the timings are reported with machine / candidate / sample counts
 * (`docs/validation.md`, "Search and scale").
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SiteData, SitesDoc } from '../src/data/contract.ts'
import { ALL_PACKAGE_FILES } from '../src/data/packageService.ts'
import { parseScientificPackage } from '../src/data/scientificPackage.ts'
import { evaluateAll, type Scenario } from '../src/app/scenarios.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario, missionStartRange } from '../src/sim/evaluate.ts'
import { findDatesForPlace } from '../src/sim/search.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DATA + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json').sites
const data = (id: string): SiteData => ({ site: sites.find((s) => s.id === id)!, ephemeris: read(`${id}/ephemeris.json`), horizon: read(`${id}/horizon.json`) })
const ridge = () => parseScientificPackage(Object.fromEntries(ALL_PACKAGE_FILES.map((n) => [n, bin(`packages/ConnectingRidge2026to2029/${n}`)])))

describe('scale edges', () => {
  it('12 scenarios evaluate side by side with labels beyond C', () => {
    const ids = sites.slice(0, 12).map((s) => s.id)
    const bySite = Object.fromEntries(ids.map((id) => [id, data(id)]))
    const scenarios: Scenario[] = ids.map((id, i) => ({ key: `k${i}`, siteId: id, startUtc: '2026-11-15T00:00:00Z' }))
    const out = evaluateAll(scenarios, DEFAULT_SETTINGS, (id) => ({ data: bySite[id] }))
    expect(out).toHaveLength(12)
    expect(out.every((o) => o.result !== null)).toBe(true)
    expect(out.map((o) => o.letter).slice(-3)).toEqual(['J', 'K', 'L'])
  })

  it('365- and 1000-day missions on the three-year package; the last valid end passes, +600 s is refused', async () => {
    const pkg = await ridge()
    for (const days of [365, 1000]) {
      const s = { ...DEFAULT_SETTINGS, durationDays: days }
      const range = missionStartRange(pkg.data.ephemeris, days)!
      const r = evaluateScenario(pkg.data, range.lastStartUtc, s)
      expect(r.count).toBe(days * 144 + 1)
      expect(Number.isFinite(r.summary.minSocFraction)).toBe(true)
      const later = new Date(Date.parse(range.lastStartUtc) + 600000).toISOString().replace('.000Z', 'Z')
      expect(() => evaluateScenario(pkg.data, later, s)).toThrow(CoverageError)
    }
  })

  it('a date search for a 365-day mission on the package completes and its best equals the direct run', async () => {
    const pkg = await ridge()
    const s = { ...DEFAULT_SETTINGS, durationDays: 365 }
    const range = missionStartRange(pkg.data.ephemeris, 365)!
    const r = await findDatesForPlace({ data: pkg.data, settings: s, fromUtc: range.firstStartUtc, toUtc: range.lastStartUtc, coarseStepS: 14 * 86400, refine: false })
    expect(r.status).toBe('complete')
    if (r.best) expect(r.best.summary).toEqual(evaluateScenario(pkg.data, r.best.startUtc, s).summary)
    else expect(r.failureCounts.reserve ?? r.failureCounts.earthOutage).toBeGreaterThan(0)
  }, 120000)

  it('cancel mid-way returns partial results without a best', async () => {
    const pkg = await ridge()
    const ctl = new AbortController()
    const r = await findDatesForPlace({ data: pkg.data, settings: DEFAULT_SETTINGS, fromUtc: '2026-11-01T00:00:00Z', toUtc: '2029-10-01T00:00:00Z', coarseStepS: 3600, refine: false }, { signal: ctl.signal, chunkSize: 50, onProgress: (d) => { if (d >= 100) ctl.abort() } })
    expect(r.status).toBe('cancelled')
    expect(r.tested).toBe(100)
    expect(r.best).toBeNull()
  })
})
