import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../sim/evaluate.ts'
import { decodeShare, encodeShare } from './share.ts'

const SITES = ['Site04', 'Site04R', 'CE6']
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

  it('keeps at most three scenarios', () => {
    const many = '#s=' + Array(5).fill('Site04@2026-11-15T00:00').join(',')
    expect(decodeShare(many, SITES)?.scenarios).toHaveLength(3)
  })
})
