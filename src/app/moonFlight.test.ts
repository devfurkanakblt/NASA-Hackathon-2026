import { describe, expect, it } from 'vitest'
import { createMoonRoute, moonPosition, sampleMoonRoute } from './moonFlight.ts'

describe('lunar camera routes', () => {
  it('takes the short arc across the longitude seam, in both directions', () => {
    for (const sign of [-1, 1]) {
      const from = { latDeg: 0, lonDeg: 179 * sign }
      const to = { latDeg: 0, lonDeg: -179 * sign }
      const middle = sampleMoonRoute(createMoonRoute(from, to), .5).direction
      expect(middle.angleTo(moonPosition(from)) * 180 / Math.PI).toBeCloseTo(1)
      expect(middle.angleTo(moonPosition(to)) * 180 / Math.PI).toBeCloseTo(1)
    }
  })

  it('stays at the departure during zoom-out and centres the destination during zoom-in', () => {
    const from = { latDeg: -89.7668, lonDeg: -171.87 }
    const to = { latDeg: .67416, lonDeg: 23.47314 }
    const route = createMoonRoute(from, to)
    expect(sampleMoonRoute(route, .1).direction.distanceTo(moonPosition(from))).toBeLessThan(1e-10)
    expect(sampleMoonRoute(route, .9).direction.distanceTo(moonPosition(to))).toBeLessThan(1e-10)
    expect(sampleMoonRoute(route, 0).distance).toBeCloseTo(1.045)
    expect(sampleMoonRoute(route, .5).distance).toBeCloseTo(2.595)
    expect(sampleMoonRoute(route, 1).distance).toBeCloseTo(1.045)
  })

  it('handles coincident and antipodal sites without crossing the sphere', () => {
    const from = { latDeg: 0, lonDeg: 0 }
    for (const to of [from, { latDeg: 0, lonDeg: 180 }]) {
      const route = createMoonRoute(from, to)
      for (let i = 0; i <= 100; i++) {
        const sample = sampleMoonRoute(route, i / 100)
        expect(sample.direction.length()).toBeCloseTo(1)
        expect(sample.distance).toBeGreaterThan(1)
      }
      expect(sampleMoonRoute(route, 1).direction.distanceTo(moonPosition(to))).toBeLessThan(1e-10)
    }
  })
})
