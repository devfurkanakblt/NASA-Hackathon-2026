/// <reference types="node" />
/** Better start dates at the same place, on the real one-year JPL Horizons series and LOLA horizons. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EphemerisDoc, Psr, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { SCAN_STEP_S, betterDatesFor, scanStartDates } from '../src/sim/betterDates.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'
import { RESEARCH_TYPES, researchMetrics } from '../src/sim/research.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const readBin = (p: string): ArrayBuffer => {
  const b = readFileSync(DATA + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const optional = <T>(p: string): T | undefined => { try { return read<T>(p) } catch { return undefined } }
const sites = read<SitesDoc>('sites.json')
const psrs = read<{ psrs: Psr[] }>('psr-south.json').psrs
const year = (id: string): EphemerisDoc => parseYear(id, read<ExtendedHeader>(`${id}/extended.json`), readBin(`${id}/year.bin`))
const yearData = (id: string): SiteData => {
  const site = sites.sites.find((s) => s.id === id)!
  return { site, ephemeris: year(id), horizon: read(`${id}/horizon.json`), map: optional(`${id}/map.json`), season: optional(`${id}/season.json`) } as SiteData
}
const type = (id: string) => RESEARCH_TYPES.find((t) => t.id === id)!
const start = '2026-11-15T00:00:00Z'

function setup(id: string) {
  const data = yearData(id)
  const result = evaluateScenario(data, start, DEFAULT_SETTINGS)
  const chosen = researchMetrics(data, result, psrs)
  const candidates = scanStartDates(data.ephemeris, data.horizon, chosen, result.durationS)
  return { data, chosen, candidates }
}

const ridge = setup('Site04R')
const wall = setup('Site04')
const malapert = setup('Site23')

describe('scanStartDates', () => {
  it('measures each start exactly as the engine does', () => {
    for (const { data, candidates, chosen } of [ridge, malapert]) {
      for (const c of [candidates[0], candidates[200], candidates[777], candidates.at(-1)!]) {
        const m = researchMetrics(data, evaluateScenario(data, c.startUtc, DEFAULT_SETTINGS), psrs)
        for (const key of ['longestSunS', 'longestEarthS', 'longestBothS', 'sunFraction', 'earthFraction', 'bothFraction'] as const) {
          expect(c.metrics[key]).toBeCloseTo(m[key], 6)
        }
        expect(c.metrics.psrEdgeKm).toBe(chosen.psrEdgeKm)
      }
    }
  })

  it('covers the whole year every 6 hours, leaving room for the mission', () => {
    const { candidates, data } = ridge
    expect(Date.parse(candidates[1].startUtc) - Date.parse(candidates[0].startUtc)).toBe(SCAN_STEP_S * 1000)
    expect(candidates[0].startUtc).toBe('2026-11-01T00:00:00Z')
    const end = Date.parse(data.ephemeris.startUtc) + (data.ephemeris.count - 1) * data.ephemeris.stepS * 1000
    expect(Date.parse(candidates.at(-1)!.startUtc) + DEFAULT_SETTINGS.durationDays * 86400e3).toBeLessThanOrEqual(end)
    expect(candidates.length).toBeGreaterThan(1400)
  })
})

describe('betterDatesFor', () => {
  it('says the 15 Nov start at the Shackleton ridge already lies in a good window for a long stay', () => {
    const advice = betterDatesFor(type('stay'), ridge.candidates, start, ridge.chosen)
    expect(advice.fit).toBe('strong')
    expect(advice.current).not.toBeNull()
    expect(Date.parse(advice.current!.firstUtc)).toBeLessThanOrEqual(Date.parse(start))
    expect(Date.parse(advice.current!.lastUtc)).toBeGreaterThanOrEqual(Date.parse(start))
  })

  it('finds no date for Earth contact on the Shackleton wall, where Earth never rises', () => {
    const advice = betterDatesFor(type('comms'), wall.candidates, start, wall.chosen)
    expect(advice.fit).toBeNull()
    expect(advice.options).toEqual([])
  })

  it('offers at most three other windows, by date, each one really reaching the fit', () => {
    for (const place of [ridge, wall, malapert]) {
      for (const t of RESEARCH_TYPES.filter((r) => r.dependsOnDate)) {
        const advice = betterDatesFor(t, place.candidates, start, place.chosen)
        expect(advice.options.length).toBeLessThanOrEqual(3)
        const firsts = advice.options.map((w) => Date.parse(w.firstUtc))
        expect([...firsts].sort((a, b) => a - b)).toEqual(firsts)
        for (const w of advice.options) {
          expect(w).not.toBe(advice.current)
          expect(w.tags.length).toBeGreaterThan(0)
          const m = researchMetrics(place.data, evaluateScenario(place.data, w.best.startUtc, DEFAULT_SETTINGS), psrs)
          expect(t.assess(m).fit).toBe(advice.fit)
        }
      }
    }
  })

  it('tags windows earlier and later than the chosen start correctly', () => {
    const advice = betterDatesFor(type('crew'), malapert.candidates, start, malapert.chosen)
    for (const w of advice.options) {
      if (w.tags.includes('earlier')) expect(Date.parse(w.lastUtc)).toBeLessThan(Date.parse(start))
      if (w.tags.includes('later')) expect(Date.parse(w.firstUtc)).toBeGreaterThan(Date.parse(start))
    }
  })

  it('only marks dates for research that changes with the date', () => {
    expect(RESEARCH_TYPES.filter((t) => t.dependsOnDate).map((t) => t.id)).toEqual(['stay', 'comms', 'crew'])
  })
})
