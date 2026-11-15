import { describe, expect, it } from 'vitest'
import { fmtLatLon } from './format.ts'
import { scenarioTitle } from './placeName.ts'
import { REFERENCE_LANDINGS } from './referenceLandings.ts'

describe('coordinate and scenario labels', () => {
  it('formats latitude and longitude with hemisphere letters and no negative zero', () => {
    expect(fmtLatLon(0.674, 23.473)).toBe('0.674°N, 23.473°E')
    expect(fmtLatLon(-75, -30)).toBe('75.000°S, 30.000°W')
    expect(fmtLatLon(-0.00001, 24)).toBe('0.000°, 24.000°E')
  })

  it('adds the start date only when two scenarios share a place', () => {
    const all = [
      { key: 'a', siteId: 'X', startUtc: '2026-11-15T00:00:00Z' },
      { key: 'b', siteId: 'Y', startUtc: '2026-11-15T00:00:00Z' },
      { key: 'c', siteId: 'Y', startUtc: '2026-11-18T06:30:00Z' },
    ]
    expect(scenarioTitle(all[0], all, {})).toBe('X')
    expect(scenarioTitle(all[1], all, {})).toBe('Y · 15 Nov 2026')
    expect(scenarioTitle(all[2], all, {})).toBe('Y · 18 Nov 2026 06:30 UTC')
  })

  it('lists northern reference landings with valid coordinates', () => {
    expect(REFERENCE_LANDINGS.some(l => l.name === 'Apollo 11')).toBe(true)
    for (const l of REFERENCE_LANDINGS) {
      expect(l.latDeg).toBeGreaterThan(0)
      expect(Math.abs(l.lonDeg)).toBeLessThanOrEqual(180)
    }
  })
})
