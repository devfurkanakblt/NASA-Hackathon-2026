import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../sim/evaluate.ts'
import { decodeShare, encodeShare } from './share.ts'

const SITES = (id: string) => ['Site04', 'Site04R', 'CE6'].includes(id) || /^Site04:r\d+c\d+$/.test(id)
const strip = (state: ReturnType<typeof decodeShare>) => state && { ...state, scenarios: state.scenarios.map(({ siteId, startUtc }) => ({ siteId, startUtc })) }

describe('shareable link', () => {
  const scenarios = [
    { key: 'a', siteId: 'Site04', startUtc: '2026-11-15T00:00:00Z' },
    { key: 'b', siteId: 'Site04R', startUtc: '2026-11-18T00:00:00Z' },
  ]

  it('writes only what differs from the defaults', () => {
    expect(encodeShare({ scenarios, active: 0, settings: DEFAULT_SETTINGS })).toBe('#s=Site04@2026-11-15T00:00,Site04R@2026-11-18T00:00')
    expect(encodeShare({ scenarios, active: 1, settings: { ...DEFAULT_SETTINGS, durationDays: 10, panelMode: 'fixed' } })).toBe(
      '#s=Site04@2026-11-15T00:00,Site04R@2026-11-18T00:00&a=B&set=durationDays:10,panelMode:fixed',
    )
  })

  it('reads back what it wrote', () => {
    const settings = { ...DEFAULT_SETTINGS, durationDays: 10, reserveFraction: 0.35, sunDiskModel: 'partial' as const }
    const decoded = decodeShare(encodeShare({ scenarios, active: 1, settings }), SITES)
    expect(strip(decoded)).toEqual({ scenarios: scenarios.map(({ siteId, startUtc }) => ({ siteId, startUtc })), active: 1, settings })
  })

  it('ignores what it cannot read', () => {
    expect(decodeShare('', SITES)).toBeNull()
    expect(decodeShare('#s=Nowhere@2026-11-15T00:00', SITES)).toBeNull()
    const d = decodeShare('#s=Site04@2026-13-40T00:00,CE6@2026-11-20T06:00&a=C&set=durationDays:abc,panelMode:sideways,baseLoadW:250,hack:1,%E0:1', SITES)
    expect(strip(d)).toEqual({ scenarios: [{ siteId: 'CE6', startUtc: '2026-11-20T06:00:00Z' }], active: 0, settings: { ...DEFAULT_SETTINGS, baseLoadW: 250 } })
  })

  it('keeps every scenario without the former three-point truncation', () => {
    const many = '#s=' + Array(5).fill('Site04@2026-11-15T00:00').join(',')
    expect(decodeShare(many, SITES)?.scenarios).toHaveLength(5)
  })

  it('round trips thirty scenarios, a label after Z, and a year-long duration', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...scenarios[0], key: String(i) }))
    const hash = encodeShare({ scenarios: many, active: 26, settings: { ...DEFAULT_SETTINGS, durationDays: 365 } })
    expect(hash).toContain('a=AA')
    const decoded = decodeShare(hash, SITES)!
    expect(decoded.scenarios).toHaveLength(30)
    expect(decoded.active).toBe(26)
    expect(decoded.settings.durationDays).toBe(365)
  })

  it('share link keeps a cell scenario', () => {
    const cell = [{ key: 'c', siteId: 'Site04:r5c55', startUtc: '2027-04-10T00:00:00Z' }, ...scenarios]
    const hash = encodeShare({ scenarios: cell, active: 0, settings: DEFAULT_SETTINGS })
    expect(hash).toBe('#s=Site04:r5c55@2027-04-10T00:00,Site04@2026-11-15T00:00,Site04R@2026-11-18T00:00')
    expect(strip(decodeShare(hash, SITES))?.scenarios[0]).toEqual({ siteId: 'Site04:r5c55', startUtc: '2027-04-10T00:00:00Z' })
    expect(decodeShare('#s=CE6:r1c1@2026-11-15T00:00', SITES)).toBeNull()
  })
})
