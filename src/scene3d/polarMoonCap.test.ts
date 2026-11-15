import { describe, expect, it } from 'vitest'
import { polarUv } from './PolarMoonCap.tsx'
import { moonPosition } from '../app/moonFlight.ts'

describe('polar photo projection on the globe', () => {
  const bounds = [-200000, -200000, 200000, 200000]
  it('maps the pole to the image centre, independent of longitude', () => {
    for (const lon of [-180, -90, 0, 90, 180]) {
      const p = moonPosition({ latDeg: -90, lonDeg: lon })
      expect(polarUv(p.x, p.y, p.z, bounds)[0]).toBeCloseTo(.5, 12)
      expect(polarUv(p.x, p.y, p.z, bounds)[1]).toBeCloseTo(.5, 12)
    }
  })
  it('places four meridians on their correct stereographic axes', () => {
    const radius = 2 * 1737400 * Math.tan(3 * Math.PI / 180)
    for (const lon of [0, 90, 180, -90]) {
      const p = moonPosition({ latDeg: -84, lonDeg: lon })
      const uv = polarUv(p.x, p.y, p.z, bounds)
      expect(uv[0]).toBeCloseTo(.5 + radius * Math.sin(lon * Math.PI / 180) / 400000, 10)
      expect(uv[1]).toBeCloseTo(.5 + radius * Math.cos(lon * Math.PI / 180) / 400000, 10)
    }
  })
})
