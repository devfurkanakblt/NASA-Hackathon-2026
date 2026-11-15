import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  FINAL_GROUND, FINAL_HEIGHT_M, HANDOFF, MOON_RADIUS_KM, SHACKLETON, SUN_DIRECTION,
  descentPose, directionToMap, introPose, mapToDirection, startDistance,
} from './descentPath.ts'

const FOV = 32

describe('descentPose', () => {
  it('starts looking at the Moon centre with north up', () => {
    const pose = descentPose(0, FOV, 16 / 9)
    const toCentre = pose.position.clone().negate().normalize()
    expect(pose.forward.dot(toCentre)).toBeCloseTo(1, 6)
    expect(pose.up.y).toBeGreaterThan(0.9)
    expect(pose.position.length()).toBeCloseTo(startDistance(FOV, 16 / 9), 6)
  })

  it('leaves the distant intro exactly as it was up to the hand-off', () => {
    for (let i = 0; i <= 45; i++) {
      const p = (i / 45) * HANDOFF
      const a = descentPose(p, FOV, 16 / 9), b = introPose(p, FOV, 16 / 9)
      expect(a.position.distanceTo(b.position)).toBe(0)
      expect(a.forward.distanceTo(b.forward)).toBe(0)
    }
  })

  it('ends low over the measured ground, facing forward with the horizon in view and the Sun to the right', () => {
    const pose = descentPose(1, FOV, 16 / 9)
    const radial = pose.position.clone().normalize()
    const [x, y] = directionToMap(radial)
    expect(Math.hypot(x - FINAL_GROUND[0], y - FINAL_GROUND[1])).toBeLessThan(1)
    expect(pose.altitude * MOON_RADIUS_KM * 1000).toBeCloseTo(FINAL_HEIGHT_M, 3)
    // Looking a few degrees below the horizontal, no roll.
    const lookDown = Math.asin(-pose.forward.dot(radial)) * 180 / Math.PI
    expect(lookDown).toBeGreaterThan(3)
    expect(lookDown).toBeLessThan(10)
    expect(pose.up.dot(radial)).toBeGreaterThan(0.98)
    // Shackleton ahead and left of centre; the Sun ahead and to the right, just off frame.
    const right = pose.forward.clone().cross(pose.up)
    const crater = mapToDirection(...SHACKLETON).sub(pose.position).normalize()
    expect(crater.dot(pose.forward)).toBeGreaterThan(0.9)
    expect(crater.dot(right)).toBeLessThan(0)
    const sunFlat = SUN_DIRECTION.clone().addScaledVector(radial, -SUN_DIRECTION.dot(radial)).normalize()
    const fwdFlat = pose.forward.clone().addScaledVector(radial, -pose.forward.dot(radial)).normalize()
    const sunAzimuth = Math.atan2(sunFlat.dot(right), sunFlat.dot(fwdFlat)) * 180 / Math.PI
    expect(sunAzimuth).toBeGreaterThan(20)
    expect(sunAzimuth).toBeLessThan(45)
  })

  it('keeps an orthonormal frame, never flips, and moves continuously', () => {
    for (const aspect of [16 / 9, 0.46]) {
      let previous: { up: Vector3; forward: Vector3; position: Vector3 } | null = null
      for (let i = 0; i <= 2000; i++) {
        const pose = descentPose(i / 2000, FOV, aspect)
        expect(pose.forward.length()).toBeCloseTo(1, 6)
        expect(pose.up.length()).toBeCloseTo(1, 6)
        expect(Math.abs(pose.forward.dot(pose.up))).toBeLessThan(1e-5)
        expect(pose.altitude).toBeGreaterThan(0)
        if (previous) {
          expect(pose.up.dot(previous.up)).toBeGreaterThan(0.995)
          expect(pose.forward.dot(previous.forward)).toBeGreaterThan(0.995)
          expect(pose.position.distanceTo(previous.position)).toBeLessThan(0.03)
        }
        previous = { up: pose.up.clone(), forward: pose.forward.clone(), position: pose.position.clone() }
      }
    }
  })

  it('round-trips the stereographic grid and clamps progress', () => {
    const [x, y] = directionToMap(mapToDirection(12345, -67890))
    expect(x).toBeCloseTo(12345, 4)
    expect(y).toBeCloseTo(-67890, 4)
    expect(descentPose(-1, FOV, 1).position.equals(descentPose(0, FOV, 1).position)).toBe(true)
    expect(descentPose(2, FOV, 1).position.equals(descentPose(1, FOV, 1).position)).toBe(true)
    expect(startDistance(FOV, 0.46)).toBeGreaterThan(startDistance(FOV, 16 / 9))
  })
})
