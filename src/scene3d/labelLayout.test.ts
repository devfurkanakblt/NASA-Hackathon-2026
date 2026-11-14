import { describe, expect, it } from 'vitest'
import { placeLabel } from './labelLayout.ts'

describe('projected label placement', () => {
  it('moves a colliding bottom-edge label upward while keeping both fully in the viewport', () => {
    const first = placeLabel({ x: 160, y: 320, w: 150, h: 20 }, 320, 320, [])
    const second = placeLabel({ x: 160, y: 320, w: 160, h: 20 }, 320, 320, [first])
    expect(first.y + first.h / 2).toBeLessThanOrEqual(316)
    expect(second.y + second.h / 2).toBeLessThanOrEqual(316)
    expect(second.y).toBeLessThan(first.y - 20)
  })
  it('reclamps every collision candidate on all four viewport edges', () => {
    const placed = []
    for (const [x, y] of [[0, 0], [0, 0], [320, 320], [320, 320]]) {
      const b = placeLabel({ x, y, w: 100, h: 20 }, 320, 320, placed)
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(4)
      expect(b.x + b.w / 2).toBeLessThanOrEqual(316)
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(4)
      expect(b.y + b.h / 2).toBeLessThanOrEqual(316)
      placed.push(b)
    }
  })
})
