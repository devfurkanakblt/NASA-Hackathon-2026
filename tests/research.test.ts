/// <reference types="node" />
/** Research types and alternatives, on the real catalogue data and the NASA Moon Trek PSR list. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Psr, SiteData, SitesDoc } from '../src/data/contract.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'
import { MAX_ALTERNATIVE_SLOPE_DEG, RESEARCH_TYPES, STAY_S, alternativesFor, arcKm, nearestPsr, researchMetrics } from '../src/sim/research.ts'
import type { ResearchMetrics } from '../src/sim/research.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const sites = read<SitesDoc>('sites.json')
const psrs = read<{ psrs: Psr[] }>('psr-south.json').psrs
const optional = <T>(p: string): T | undefined => { try { return read<T>(p) } catch { return undefined } }
const bySite: Record<string, SiteData> = Object.fromEntries(sites.sites.map((site) => [site.id, {
  site, ephemeris: read(`${site.id}/ephemeris.json`), horizon: read(`${site.id}/horizon.json`), map: optional(`${site.id}/map.json`), season: optional(`${site.id}/season.json`),
} as SiteData]))
const start = '2026-11-15T00:00:00Z'
const metrics: Record<string, ResearchMetrics> = Object.fromEntries(Object.entries(bySite).map(([id, data]) =>
  [id, researchMetrics(data, evaluateScenario(data, start, DEFAULT_SETTINGS), psrs)]))
const type = (id: string) => RESEARCH_TYPES.find((t) => t.id === id)!

describe('PSR distances (NASA Moon Trek layer)', () => {
  it('uses the equal-area circle and never goes negative', () => {
    const shackleton = psrs.find((p) => p.name === 'Shackleton Crater')!
    const atCentre = nearestPsr(shackleton.latDeg, shackleton.lonDeg, psrs)!
    expect(atCentre.edgeKm).toBe(0)
    expect(arcKm(-90, 0, -89, 0)).toBeCloseTo((Math.PI / 180) * 1737.4, 6)
  })

  it('puts Shackleton Rim next to the Shackleton PSR and the contrast sites far from any', () => {
    expect(metrics.Site04.psrEdgeKm!).toBeLessThan(2)
    expect(metrics.Site04.psrName).toBe('Shackleton Crater')
    expect(metrics.Site04R.psrEdgeKm!).toBeLessThan(5)
    expect(metrics.Apollo11.psrEdgeKm).toBeNull()
    expect(metrics.CE6.psrEdgeKm).toBeNull()
  })
})

describe('research types on the default mission (15 Nov 2026, 7 days)', () => {
  it('measures windows from the engine result', () => {
    const r = evaluateScenario(bySite.Site04R, start, DEFAULT_SETTINGS)
    expect(metrics.Site04R.longestSunS).toBe(r.durationS) // Sun up the whole mission at the ridge
    expect(metrics.Site04.longestEarthS).toBe(0)
  })

  it('rates the ridge, the wall and the far side as the data says', () => {
    expect(type('stay').assess(metrics.Site04R).fit).toBe('strong')
    expect(type('ice').assess(metrics.Site04).fit).toBe('strong')
    expect(type('comms').assess(metrics.Site04).fit).toBe('no')
    expect(type('radio').assess(metrics.CE6).fit).toBe('strong')
    expect(type('radio').assess(metrics.Apollo11).fit).toBe('no')
    expect(type('comms').assess(metrics.Apollo11).fit).toBe('strong')
  })

  it('uses the 6.5-day stay threshold quoted by NASA', () => {
    expect(STAY_S).toBe(6.5 * 86400)
    const m = { ...metrics.Site04R, longestSunS: STAY_S - 1 }
    expect(type('stay').assess(m).fit).toBe('possible')
  })
})

describe('alternatives', () => {
  const all = Object.values(metrics)

  it('never lists the place itself, a steep place or one that does not fit', () => {
    for (const t of RESEARCH_TYPES) {
      for (const selected of all) {
        for (const a of alternativesFor(t, selected, all, 9)) {
          expect(a.metrics.siteId).not.toBe(selected.siteId)
          expect(a.fit).not.toBe('no')
          if (a.metrics.slopeDeg !== null) expect(a.metrics.slopeDeg).toBeLessThanOrEqual(MAX_ALTERNATIVE_SLOPE_DEG)
        }
      }
    }
  })

  it('offers the ridge for water ice from Connecting Ridge, and drops the 32° crater wall', () => {
    const list = alternativesFor(type('ice'), metrics.Site01, all)
    expect(list[0].metrics.siteId).toBe('Site04R')
    expect(list.map((a) => a.metrics.siteId)).not.toContain('Site04')
    expect(list[0].distanceKm).toBeGreaterThan(0)
  })

  it('keeps south-polar alternatives in the south polar region', () => {
    for (const t of RESEARCH_TYPES) {
      for (const a of alternativesFor(t, metrics.Site04, all, 9)) expect(a.metrics.region).toBe('polar')
    }
  })

  it('uses the full year for Earth shielding: the far side and the Shackleton wall, not Connecting Ridge', () => {
    expect(type('radio').assess(metrics.CE6).fit).toBe('strong')
    expect(type('radio').assess(metrics.Site04).fit).toBe('strong')
    expect(type('radio').assess(metrics.Site01).fit).toBe('no')
    expect(type('radio').assess({ ...metrics.CE6, earthYearPct: null }).fit).toBe('possible')
  })

  it('ranks strong fits before possible ones', () => {
    for (const t of RESEARCH_TYPES) {
      const list = alternativesFor(t, metrics.Site01, all, 9)
      const firstPossible = list.findIndex((a) => a.fit === 'possible')
      if (firstPossible >= 0) expect(list.slice(firstPossible).every((a) => a.fit === 'possible')).toBe(true)
    }
  })
})
