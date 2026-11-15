import { describe, expect, it } from 'vitest'
import { GLOBE_CAMERA_MAX_LAT_DEG, LABEL_FRAME_PAD, keepLabelInFrame, labelOffset, southernCameraPosition } from './globeView.ts'

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

describe('labelOffset', () => {
  it('alternates label rows above and below and keeps them within two rows of the pins', () => {
    const ys = Array.from({ length: 12 }, (_, i) => labelOffset(i).y)
    expect(ys.slice(0, 3).every((y) => y < 0)).toBe(true)
    expect(ys.slice(3, 6).every((y) => y > 0)).toBe(true)
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(95)
    expect(labelOffset(0).x).toBe(-190)
    expect(labelOffset(7).mobileX).toBe(79)
  })
})

describe('keepLabelInFrame', () => {
  const frame = { w: 500, h: 500 }, label = { w: 150, h: 40 }

  it('does not move a label that already fits', () => {
    expect(keepLabelInFrame({ x: 250, y: 250 }, { x: -79, y: 40 }, label, frame)).toEqual({ x: 0, y: 0 })
  })

  it('pulls a label at the rim back inside, clear of the bottom credit', () => {
    const anchor = { x: 490, y: 480 }, pin = { x: 79, y: 40 }
    const shift = keepLabelInFrame(anchor, pin, label, frame)
    const cx = anchor.x + pin.x + shift.x, cy = anchor.y + pin.y + shift.y
    expect(cx + label.w / 2).toBe(frame.w - LABEL_FRAME_PAD.side)
    expect(cy + label.h / 2).toBe(frame.h - LABEL_FRAME_PAD.bottom)
  })

  it('centres a label wider than the frame', () => {
    const shift = keepLabelInFrame({ x: 0, y: 250 }, { x: 0, y: 0 }, { w: 600, h: 40 }, frame)
    expect(shift.x).toBe(250)
  })
})
