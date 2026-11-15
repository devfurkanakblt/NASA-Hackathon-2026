import { describe, expect, it } from 'vitest'
import { SphereGeometry } from 'three'
import { moonPosition } from '../app/moonFlight.ts'

describe('global NASA image registration on the unchanged Moon locator', () => {
  it('matches Greenwich, east longitudes and north with the real SphereGeometry UVs', () => {
    const sphere = new SphereGeometry(1, 32, 16)
    const uv = sphere.getAttribute('uv'), positions = sphere.getAttribute('position')
    for (const [latitude, longitude] of [[0, 0], [0, 90], [0, -90], [45, 0], [-45, 90]]) {
      const expectedU = (longitude + 180) / 360, expectedV = (latitude + 90) / 180
      let index = -1
      for (let i = 0; i < uv.count; i++) {
        if (Math.abs(uv.getX(i) - expectedU) < 1e-6 && Math.abs(uv.getY(i) - expectedV) < 1e-6) { index = i; break }
      }
      expect(index).toBeGreaterThanOrEqual(0)
      const marker = moonPosition({ latDeg: latitude, lonDeg: longitude })
      expect(positions.getX(index)).toBeCloseTo(marker.x, 6)
      expect(positions.getY(index)).toBeCloseTo(marker.y, 6)
      expect(positions.getZ(index)).toBeCloseTo(marker.z, 6)
    }
    sphere.dispose()
  })
})
