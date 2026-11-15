import { describe, expect, it } from 'vitest'
import { GLOBE_CAMERA_MAX_LAT_DEG, southernCameraPosition } from './globeView.ts'

const lat = ([x, y, z]: [number, number, number]) => Math.asin(y / Math.hypot(x, y, z)) * 180 / Math.PI

describe('southernCameraPosition', () => {
  it('leaves southern views alone', () => {
    expect(southernCameraPosition([0, -2.8, 0.65])).toEqual([0, -2.8, 0.65])
  })

  it('pulls a northern overview back to the limit, keeping distance and longitude', () => {
    const p = southernCameraPosition([2, 1, -1])
    expect(lat(p)).toBeCloseTo(GLOBE_CAMERA_MAX_LAT_DEG, 9)
    expect(Math.hypot(...p)).toBeCloseTo(Math.hypot(2, 1, -1), 9)
    expect(Math.atan2(p[2], p[0])).toBeCloseTo(Math.atan2(-1, 2), 9)
  })

  it('handles a camera right above the north pole', () => {
    const p = southernCameraPosition([0, 3, 0])
    expect(lat(p)).toBeCloseTo(GLOBE_CAMERA_MAX_LAT_DEG, 9)
  })

  it('does not limit close inspection of one place', () => {
    expect(southernCameraPosition([1.01, 0.05, 0])).toEqual([1.01, 0.05, 0])
  })
})
