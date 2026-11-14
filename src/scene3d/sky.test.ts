import { describe, expect, it } from 'vitest'
import { vectorToAzEl } from './coords.ts'
import { skyPathLine } from './sky.ts'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('skyPathLine', () => {
  const path = {
    azDeg: [10, 20, 30, 40, 50],
    elDeg: [1, 2, 3, 2, -1],
    visible: [true, true, false, false, false],
  }

  it('puts every sample on the sky sphere at its azimuth and elevation', () => {
    const { points, visible } = skyPathLine(path, 1000)
    expect(points.length).toBe(5)
    expect(visible).toEqual([true, true, false, false, false])
    points.forEach((p, i) => {
      close(Math.hypot(...p), 1000)
      close(vectorToAzEl(p).azDeg, path.azDeg[i])
      close(vectorToAzEl(p).elDeg, path.elDeg[i])
    })
  })

  it('thins long tracks but keeps the first and the last sample', () => {
    const n = 8785
    const long = { azDeg: Array.from({ length: n }, (_, i) => (i * 0.085) % 360), elDeg: Array.from({ length: n }, () => 1) }
    const { points, visible } = skyPathLine(long, 500, 3000)
    expect(points.length).toBeLessThanOrEqual(3001)
    expect(points.length).toBeGreaterThan(2000)
    close(vectorToAzEl(points[0]).azDeg, 0)
    close(vectorToAzEl(points[points.length - 1]).azDeg, ((n - 1) * 0.085) % 360, 1e-4)
    expect(visible.every(Boolean)).toBe(true)
  })

  it('handles empty and single-sample paths', () => {
    expect(skyPathLine({ azDeg: [], elDeg: [] }, 100).points).toEqual([])
    expect(skyPathLine({ azDeg: [90], elDeg: [0] }, 100).points.length).toBe(1)
  })
})
