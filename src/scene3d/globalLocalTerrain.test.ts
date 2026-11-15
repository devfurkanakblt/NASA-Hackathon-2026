import { describe, expect, it } from 'vitest'
import { globalLocalTerrain } from './globalLocalTerrain.ts'
import type { GlobalTerrain } from './globalTerrain.ts'

const R = 1737400
const flat: GlobalTerrain = { width: 5760, height: 2880, scaleM: .5, referenceRadiusM: R, heightAt: () => 1500, northPoleM: 1500, southPoleM: 1500 }

describe('global DEM to local C display frame', () => {
  it('matches the analytical curved sphere in metres at any latitude, including both poles', () => {
    for (const latDeg of [-90, -89.5, 0, 45, 90]) {
      const grid = globalLocalTerrain(flat, { latDeg, lonDeg: 179.99, surfaceElevationM: 1500 }, 2, 30000, 5)
      for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
        const e = (col + .5) * grid.cellM - 15000, n = (row + .5) * grid.cellM - 15000
        expect(grid.zM[row * 5 + col]).toBeCloseTo(Math.sqrt((R + 1500) ** 2 - e * e - n * n) - R - 1500 - 2, 6)
      }
      expect(grid.zM[12]).toBe(-2)
    }
  })

  it('keeps north in increasing rows and east in increasing columns', () => {
    const sloped: GlobalTerrain = { ...flat, heightAt: (lat, lon) => lat * 100 + (lon > 180 ? lon - 360 : lon) * 10 }
    const g = globalLocalTerrain(sloped, { latDeg: 0, lonDeg: 0, surfaceElevationM: 0 }, 2, 30000, 5)
    expect(g.zM[17]).toBeGreaterThan(g.zM[7])
    expect(g.zM[13]).toBeGreaterThan(g.zM[11])
  })

  it('only aligns the display datum, without modifying the site or the height source', () => {
    const site = { latDeg: -89.5, lonDeg: -137.49, surfaceElevationM: -1200 }
    const g = globalLocalTerrain(flat, site, 2, 30000, 5)
    expect(g.zM[12]).toBe(-2)
    expect(site.surfaceElevationM).toBe(-1200)
    expect(flat.heightAt!(site.latDeg, site.lonDeg)).toBe(1500)
  })
})
