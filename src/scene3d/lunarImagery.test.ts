import { describe, expect, it } from 'vitest'
import { lunarImageryTransform, mapScaleBar } from './lunarImagery.ts'

describe('NASA ENU archive-image registration', () => {
  it('keeps north up and west/east registered on a same-size image', () => {
    const t = lunarImageryTransform(10_000, 10_000)
    const uv = (eastM: number, northM: number) => [(eastM / 10_000 + 0.5) * t.repeat + t.offset,
      (northM / 10_000 + 0.5) * t.repeat + t.offset]
    expect(uv(0, 0)).toEqual([0.5, 0.5])
    expect(uv(-5000, 5000)).toEqual([0, 1])
    expect(uv(5000, -5000)).toEqual([1, 0])
  })
  it('registers the same measured point through local and regional mesh UVs', () => {
    const east = 3250, north = -1250
    const regional = lunarImageryTransform(240_000, 240_000)
    const local = lunarImageryTransform(10_000, 240_000)
    expect((east / 10_000 + 0.5) * local.repeat + local.offset).toBeCloseTo((east / 240_000 + 0.5) * regional.repeat + regional.offset, 12)
    expect((north / 10_000 + 0.5) * local.repeat + local.offset).toBeCloseTo((north / 240_000 + 0.5) * regional.repeat + regional.offset, 12)
  })
  it('rejects invalid footprints instead of inventing a texture registration', () => {
    for (const value of [0, -1, NaN, Infinity]) expect(() => lunarImageryTransform(10_000, value)).toThrow()
  })
})

describe('centre-of-map metric scale', () => {
  it('derives the labelled distance from actual metres per CSS pixel', () => {
    const scale = mapScaleBar(12.5)!
    expect(scale.label).toBe('1 km')
    expect(scale.metres).toBe(1000)
    expect(scale.widthPx).toBe(80)
    expect(scale.metres / scale.widthPx).toBe(12.5)
  })
  it('changes scale when zoomed and handles unavailable projection state', () => {
    expect(mapScaleBar(1)?.label).toBe('50 m')
    expect(mapScaleBar(1000)?.label).toBe('50 km')
    expect(mapScaleBar(0)).toBeUndefined()
    expect(mapScaleBar(NaN)).toBeUndefined()
  })
})
