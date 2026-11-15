import { describe, expect, it } from 'vitest'
import { earthWobble } from './libration.ts'

describe('earthWobble', () => {
  it('measures the azimuth span across the 0°/360° wrap', () => {
    const w = earthWobble([355, 358, 2, 6], [1, 2, 3, 4])!
    expect(w.azSpanDeg).toBeCloseTo(11, 6)
  })

  it('reports a loop that crosses the flat horizon near the pole', () => {
    const w = earthWobble([10, 20, 15], [-6, 6, 0])!
    expect(w).toMatchObject({ elMinDeg: -6, elMaxDeg: 6, loop: 'crosses-horizon', azSpanDeg: 10 })
  })

  it('separates always-up (near side) from never-up (far side)', () => {
    expect(earthWobble([0, 30], [57, 74])!.loop).toBe('always-up')
    expect(earthWobble([0, 14], [-51, -33])!.loop).toBe('never-up')
  })

  it('returns null without samples', () => {
    expect(earthWobble([], [])).toBeNull()
  })
})
