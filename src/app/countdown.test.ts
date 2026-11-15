/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SiteData, SitesDoc } from '../data/contract.ts'
import { parseYear, type ExtendedHeader } from '../data/extended.ts'
import { DEFAULT_SETTINGS, evaluateScenario, sampleUtc } from '../sim/evaluate.ts'
import { countdown } from './countdown.ts'

const DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DIR + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DIR + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const data = (id: string): SiteData => ({ site: read<SitesDoc>('sites.json').sites.find((s) => s.id === id)!, ephemeris: read(`${id}/ephemeris.json`), horizon: read(`${id}/horizon.json`) })

describe('countdown', () => {
  it('Site07: the Sun stays up all mission; the next real sunset comes from the year series, not the mission end', () => {
    const d = data('Site07')
    const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    const end = sampleUtc(r, r.count - 1)
    expect(countdown(r.sunWindows, true, 0)).toBe('in view for the rest of the mission')
    const year = parseYear('Site07', read<ExtendedHeader>('Site07/extended.json'), bin('Site07/year.bin'))
    expect(countdown(r.sunWindows, true, 0, { ephemeris: year, horizon: d.horizon, body: 'sun', missionEndUtc: end })).toMatch(/^in view for the rest of the mission; next set after it: 2027-\d\d-\d\d \d\d:\d\d UTC$/)
    // with only the two-month series: an honest data limit, never "never sets"
    expect(countdown(r.sunWindows, true, 0, { ephemeris: d.ephemeris, horizon: d.horizon, body: 'sun', missionEndUtc: end })).toBe(
      'in view for the rest of the mission; no set within the available data (until 2027-01-01 00:00 UTC)',
    )
  })
  it('Site04: Earth hidden all mission, no rise in the two months', () => {
    const d = data('Site04')
    const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(countdown(r.earthWindows, false, 0, { ephemeris: d.ephemeris, horizon: d.horizon, body: 'earth', missionEndUtc: sampleUtc(r, r.count - 1) })).toMatch(/hidden for the rest of the mission; no rise within the available data/)
  })
  it('a transition inside the mission is reported as before', () => {
    const d = data('Site01')
    const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(countdown(r.earthWindows, r.earthVisible[0], 0)).toMatch(/^(in view, sets|hidden, rises) in /)
  })
})
