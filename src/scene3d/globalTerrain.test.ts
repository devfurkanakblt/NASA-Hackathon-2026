import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { globalGeometry, globalHeightM, terrainRadius } from './globalTerrain.ts'
import type { GlobalTerrain } from './globalTerrain.ts'

const raster: GlobalTerrain = {
  width: 4, height: 2, scaleM: 2, referenceRadiusM: 1737400,
  values: new Int16Array([1, 2, 3, 4, 5, 6, 7, 8]), northPoleM: 5, southPoleM: 13,
}

describe('measured whole-Moon display terrain', () => {
  it('uses pixel centres, metres and bilinear interpolation', () => {
    expect(globalHeightM(raster, 45, 45)).toBe(2)
    expect(globalHeightM(raster, -45, 45)).toBe(10)
    expect(globalHeightM(raster, 0, 45)).toBe(6)
    expect(globalHeightM(raster, 45, 90)).toBe(3)
  })

  it('wraps both longitude seams without a terrain discontinuity', () => {
    for (const lon of [-720, -180, -1, 0, 180, 359, 720]) {
      expect(globalHeightM(raster, 0, lon)).toBeCloseTo(globalHeightM(raster, 0, lon + 360), 10)
    }
    expect(globalHeightM(raster, 0, -.000001)).toBeCloseTo(globalHeightM(raster, 0, .000001), 6)
  })

  it('welds each pole to a single value and leaves sampled latitudes unchanged', () => {
    const data: GlobalTerrain = { ...raster, width: 5760, height: 2880, heightAt: () => -3000, northPoleM: -2000, southPoleM: -2500 }
    for (const lon of [-180, -12, 90, 180]) {
      expect(globalHeightM(data, 90, lon)).toBe(-2000)
      expect(globalHeightM(data, -90, lon)).toBe(-2500)
    }
    expect(globalHeightM(data, 89.96, 0)).toBe(-3000)
    expect(globalHeightM(data, -89.96, 0)).toBe(-3000)
  })

  it('preserves signed height, east-positive longitude and true radial scale', () => {
    const data: GlobalTerrain = { ...raster, heightAt: (lat, lon) => lat + lon, northPoleM: 90, southPoleM: -90 }
    expect((terrainRadius(data, new Vector3(0, 0, -1), 200) - 1) * 1737400).toBeCloseTo(290, 6)
    expect((terrainRadius(data, new Vector3(0, 0, 1)) - 1) * 1737400).toBeCloseTo(270, 6)
    expect(terrainRadius({ ...data, heightAt: () => -4000 }, new Vector3(1, 0, 0))).toBeLessThan(1)
  })

  it('renders both hemispheres, and refines a patch without exaggerating heights', () => {
    const data: GlobalTerrain = { ...raster, heightAt: () => 2000, northPoleM: 2000, southPoleM: 2000 }
    const direction = new Vector3(1, 1, 1).normalize()
    const whole = globalGeometry(data), patch = globalGeometry(data, direction, .1)
    try {
      expect(whole.boundingSphere!.radius).toBeGreaterThan(1)
      const point = new Vector3()
      for (const geometry of [whole, patch]) {
        const positions = geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i += 97) {
          point.fromBufferAttribute(positions, i)
          expect(point.length()).toBeCloseTo(1 + 2000 / 1737400, 6)
          if (geometry === patch) expect(point.angleTo(direction)).toBeLessThanOrEqual(.100001)
        }
      }
      expect(whole.boundingBox).toBeNull()
      expect(whole.getAttribute('position').getY(0)).toBeGreaterThan(1)
      expect(whole.getAttribute('position').getY(whole.getAttribute('position').count - 1)).toBeLessThan(-1)
    } finally { whole.dispose(); patch.dispose() }
  })

  it('fails explicitly when a height source is absent', () => {
    expect(() => globalHeightM({ ...raster, values: undefined }, 0, 0)).toThrow('missing')
  })
})
