/// <reference types="node" />
/** The result cards' plain-language answers on the default comparison (slide 5). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fmtPct } from '../src/app/format.ts'
import { earthVerdict, powerVerdict } from '../src/app/plain.ts'
import { defaultScenarios, evaluateAll } from '../src/app/scenarios.ts'
import type { SiteData, SitesDoc } from '../src/data/contract.ts'
import { DEFAULT_SETTINGS } from '../src/sim/evaluate.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const sites = read<SitesDoc>('sites.json')
const bySite: Record<string, SiteData> = Object.fromEntries(
  sites.sites.map((site) => [site.id, { site, ephemeris: read(`${site.id}/ephemeris.json`), horizon: read(`${site.id}/horizon.json`), terrain: read(`${site.id}/terrain.json`) } as SiteData]),
)

describe('plain-language result cards', () => {
  const [a, b, c] = evaluateAll(defaultScenarios(sites.sites.map((s) => s.id)), DEFAULT_SETTINGS, (id) => ({ data: bySite[id] })).map((o) => o.result!)

  it('shows the Sun / Earth shares of docs/presentation-notes.md on the cards', () => {
    expect([a, b, c].map((r) => [fmtPct(r.summary.sunVisibleFraction), fmtPct(r.summary.earthVisibleFraction)])).toEqual([
      ['83.5 %', '0 %'],
      ['100 %', '72 %'],
      ['100 %', '100 %'],
    ])
  })

  it('Site04 runs short of power and never sees Earth', () => {
    expect(powerVerdict(a, DEFAULT_SETTINGS)).toMatchObject({ ok: false, title: 'Runs short of power' })
    expect(powerVerdict(a, DEFAULT_SETTINGS).detail).toMatch(/day 7, then empty/)
    expect(earthVerdict(a, DEFAULT_SETTINGS)).toMatchObject({ ok: false, title: 'No view of Earth' })
  })

  it('the ridge keeps power but has long silences; three days later Earth is always up', () => {
    expect(powerVerdict(b, DEFAULT_SETTINGS).ok).toBe(true)
    expect(earthVerdict(b, DEFAULT_SETTINGS)).toMatchObject({ ok: false, title: 'Long gaps without Earth' })
    expect(earthVerdict(b, DEFAULT_SETTINGS).detail).toContain('max 6 h')
    expect(earthVerdict(c, DEFAULT_SETTINGS)).toMatchObject({ ok: true, title: 'Earth in view all mission' })
  })
})
