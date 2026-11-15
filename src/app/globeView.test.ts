import { describe, expect, it } from 'vitest'
import { LABEL_FRAME_PAD, keepLabelInFrame, labelOffset, placeGroups } from './globeView.ts'

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

describe('places in the picker list', () => {
  const sites = [
    { id: 'Site01', latDeg: -89.5 },
    { id: 'Apollo11', latDeg: 0.67, category: 'contrast' },
    { id: 'CE5', latDeg: 43.1, category: 'contrast' },
    { id: 'IM2', latDeg: -84.8, category: 'mission' },
  ]

  it('lists polar places first and keeps every place in exactly one group', () => {
    const groups = placeGroups(sites)
    expect(groups.map((g) => g.id)).toEqual(['pole', 'elsewhere'])
    expect(groups[0].sites.map((s) => s.id)).toEqual(['Site01', 'IM2'])
    expect(groups.flatMap((g) => g.sites)).toHaveLength(sites.length)
  })
})
