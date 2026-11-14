import { describe, expect, it } from 'vitest'
import { overviewHeightAboveTerrain, overviewStartPosition } from './cameraPlacement.ts'
import { buildTerrainMeshData, terrainHeightAt } from './terrainGeometry.ts'

const flat = (sizeM: number, heightM: number) => buildTerrainMeshData({ n: 8, sizeM, cellM: sizeM / 8, zM: Array(64).fill(heightM - 2) })

describe('overview camera clearance', () => {
  it('starts above high regional terrain for any compass direction', () => {
    const near = flat(10_000, 0), far = flat(240_000, 9000)
    for (const az of [0, 45, 90, 180, 270, 359]) {
      const [x, y, z] = overviewStartPosition(5000, az, near, far)
      expect(y).toBeGreaterThanOrEqual(terrainHeightAt(far, x, z)! + 50)
    }
  })
  it('uses the fine DEM in its footprint, not a coarse surface that has been removed', () => {
    expect(overviewHeightAboveTerrain(0, 10, 0, 5, flat(10_000, 0), flat(240_000, 9000))).toBe(10)
  })
  it('moves above the new site after switching and never lowers an already safe orbit', () => {
    expect(overviewStartPosition(5000, 0, undefined, flat(240_000, 9000))[1]).toBe(9050)
    expect(overviewStartPosition(5000, 0, undefined, flat(240_000, 100))[1]).toBe(2500)
    expect(overviewHeightAboveTerrain(20_000, 12_000, 0, 50, undefined, flat(240_000, 9000))).toBe(12_000)
  })
})
