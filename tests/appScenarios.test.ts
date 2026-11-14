/// <reference types="node" />
/**
 * The app's default comparison (slide 5) on the real data: the numbers on screen must be the
 * ones in docs/presentation-notes.md, and the comparison sentences must answer the planner
 * question ("which keeps the reserve and has the shorter Earth outage?") correctly.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { comparisonSentences, defaultScenarios, evaluateAll, siteTitle, targetScenarioKey } from '../src/app/scenarios.ts'
import type { SiteData, SitesDoc } from '../src/data/contract.ts'
import { J_PER_WH } from '../src/sim/energy.ts'
import { DEFAULT_SETTINGS } from '../src/sim/evaluate.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const sites = read<SitesDoc>('sites.json')
const bySite: Record<string, SiteData> = Object.fromEntries(
  sites.sites.map((site) => [site.id, { site, ephemeris: read(`${site.id}/ephemeris.json`), horizon: read(`${site.id}/horizon.json`), terrain: read(`${site.id}/terrain.json`) } as SiteData]),
)

const DEFAULT_START = '2026-11-15T00:00:00Z'
const resolve = (id: string) => (bySite[id] ? { data: bySite[id] } : { error: `No data for site ${id}.` })

describe('default comparison on the real data', () => {
  const scenarios = defaultScenarios(sites.sites.map((s) => s.id))
  const outcomes = evaluateAll(scenarios, DEFAULT_SETTINGS, resolve)

  it('is Site04, Site04R and Site04R three days later', () => {
    expect(scenarios.map((s) => [s.siteId, s.startUtc])).toEqual([
      ['Site04', '2026-11-15T00:00:00Z'],
      ['Site04R', '2026-11-15T00:00:00Z'],
      ['Site04R', '2026-11-18T00:00:00Z'],
    ])
    expect(outcomes.every((o) => o.error === null)).toBe(true)
  })

  it('shows the numbers of the presentation notes', () => {
    const [a, b, c] = outcomes.map((o) => o.result!.summary)
    expect(a.sunVisibleFraction).toBeCloseTo(0.835, 3)
    expect(a.earthVisibleFraction).toBe(0)
    expect(a.keepsBatteryReserve).toBe(false)
    expect(a.unmetEnergyJ / J_PER_WH / 1000).toBeCloseTo(1.0, 1)
    expect(b.sunVisibleFraction).toBe(1)
    expect(b.keepsBatteryReserve).toBe(true)
    expect(Math.round(b.longestEarthOutageS / 3600)).toBe(47)
    expect(c.earthVisibleFraction).toBe(1)
    expect(c.longestEarthOutageS).toBe(0)
  })

  it('answers the planner question in plain words', () => {
    expect(comparisonSentences(outcomes, DEFAULT_SETTINGS)).toEqual([
      'B and C keep the battery above its 20 % reserve; A does not.',
      'Shortest longest Earth outage: C (Earth in view the whole mission).',
      'Only C meets the accepted Earth outage of 6 h.',
    ])
  })

  it('keeps an error with its own scenario', () => {
    const late = evaluateAll([{ key: 'x', siteId: 'Site04R', startUtc: '2026-12-30T00:00:00Z' }, scenarios[0]], DEFAULT_SETTINGS, resolve)
    expect(late[0].result).toBeNull()
    expect(late[0].error).toMatch(/computed period/)
    expect(late[1].result).not.toBeNull()
  })

  it('shows a loading scenario as not evaluated, with its message', () => {
    const out = evaluateAll([{ key: 'y', siteId: 'Site07', startUtc: '2027-04-10T00:00:00Z' }, scenarios[0]], DEFAULT_SETTINGS, (id, startUtc) =>
      startUtc.startsWith('2027') ? { loading: 'Loading one-year data…' } : resolve(id),
    )
    expect(out[0].result).toBeNull()
    expect(out[0].error).toBe('Loading one-year data…')
    expect(out[0].loading).toBe(true)
    expect(out[0].data).toBeNull()
    expect(out[1].loading).toBe(false)
    expect(out[1].data).toBe(bySite.Site04)
  })

  it('map-point actions target the chosen scenario even while it is loading', () => {
    const list = [{ key: 'a', siteId: 'Site04', startUtc: DEFAULT_START }, { key: 'b', siteId: 'Site01:r36c32', startUtc: DEFAULT_START }]
    expect(targetScenarioKey(list, 'b')).toBe('b')
    expect(targetScenarioKey(list, 'gone')).toBe('a')
    expect(targetScenarioKey([], 'b')).toBeNull()
  })

  it('labels derived and contrast points', () => {
    expect(siteTitle(bySite.Site04R.site)).toBe('Site04R — Shackleton Rim (ridge point) (derived point near Site04)')
    expect(siteTitle(bySite.CE6.site)).toMatch(/\(contrast point\)$/)
  })
})
