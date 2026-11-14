import { describe, expect, it } from 'vitest'
import { vectorToAzEl } from './coords.ts'
import { buildHorizonCurtain, buildTerrainMeshData, elevationCirclePoints, horizonLinePoints } from './terrainGeometry.ts'
import type { HorizonProfile, TerrainGrid } from './types.ts'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

/**
 * 4 × 4 contract grid, 10 m cells: height (relative to the observer eye) rises
 * 1 m per column to the east and 100 m per row to the north.
 */
const grid: TerrainGrid = {
  sizeM: 40,
  n: 4,
  cellM: 10,
  zM: Array.from({ length: 16 }, (_, i) => (i % 4) + Math.floor(i / 4) * 100),
}

describe('buildTerrainMeshData', () => {
  const mesh = buildTerrainMeshData(grid, 2)
  const vertex = (col: number, row: number) => {
    const i = (row * 4 + col) * 3
    return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]
  }

  it('puts row 0 in the south (+Z) and column 0 in the west (−X), at cell centres', () => {
    expect(vertex(0, 0)).toEqual([-15, 2, 15])
    expect(vertex(3, 0)).toEqual([15, 5, 15])
    expect(vertex(0, 3)).toEqual([-15, 302, -15])
    expect(vertex(3, 3)).toEqual([15, 305, -15])
  })

  it('lifts eye-relative heights by the observer height so the site ground is y = 0', () => {
    close(mesh.minY, 2)
    close(mesh.maxY, 305)
    close(mesh.halfExtentM, 20)
    const level = buildTerrainMeshData({ ...grid, zM: new Array(16).fill(-2) }, 2)
    close(level.minY, 0)
    close(level.maxY, 0)
  })

  it('winds every triangle so that it faces up (+Y)', () => {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => {
        const i = mesh.indices[t + k] * 3
        return [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]
      })
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0)
    }
  })

  it('decimates large grids but keeps the outermost cells', () => {
    const big: TerrainGrid = {
      sizeM: 5005,
      n: 1001,
      cellM: 5,
      zM: Float32Array.from({ length: 1001 * 1001 }, (_, i) => i % 1001),
    }
    const coarse = buildTerrainMeshData(big, 2, 100)
    expect(coarse.positions.length).toBe(101 * 101 * 3)
    close(coarse.positions[0], -2500)
    close(coarse.positions[100 * 3], 2500)
    close(coarse.positions[2], 2500)
    close(coarse.halfExtentM, 2502.5)
  })

  it('rejects malformed grids', () => {
    expect(() => buildTerrainMeshData({ ...grid, zM: [1, 2, 3] })).toThrow()
    expect(() => buildTerrainMeshData({ sizeM: 5, n: 1, cellM: 5, zM: [0] })).toThrow()
    expect(() => buildTerrainMeshData({ ...grid, cellM: 0 })).toThrow()
  })
})

describe('horizon overlays', () => {
  const profile: HorizonProfile = {
    azStepDeg: 0.1,
    elevDeg: Array.from({ length: 3600 }, (_, i) => 2 * Math.sin((i * 0.1 * Math.PI) / 180)),
  }

  it('draws the horizon line at the profile angles and closes the loop', () => {
    const points = horizonLinePoints(profile, 1000)
    expect(points.length).toBe(3601)
    const east = vectorToAzEl(points[900])
    close(east.azDeg, 90)
    close(east.elDeg, 2)
    close(Math.hypot(...points[900]), 1000)
    points[0].forEach((c, k) => close(c, points[3600][k]))
  })

  it('draws constant-elevation circles', () => {
    const points = elevationCirclePoints(-0.087, 500, 90)
    expect(points.length).toBe(5)
    close(vectorToAzEl(points[1]).elDeg, -0.087)
    close(vectorToAzEl(points[1]).azDeg, 90)
  })

  it('builds a curtain whose top edge follows the profile', () => {
    const { positions, indices } = buildHorizonCurtain(profile, 1000)
    expect(positions.length).toBe(3601 * 6)
    expect(indices.length).toBe(3600 * 6)
    const top = vectorToAzEl([positions[900 * 6], positions[900 * 6 + 1], positions[900 * 6 + 2]])
    const bottom = vectorToAzEl([positions[900 * 6 + 3], positions[900 * 6 + 4], positions[900 * 6 + 5]])
    close(top.elDeg, 2)
    close(bottom.elDeg, -40)
    expect(Math.max(...indices)).toBe(3601 * 2 - 1)
  })

  it('keeps the curtain below a horizon that dips under its default bottom', () => {
    const deep: HorizonProfile = { azStepDeg: 90, elevDeg: [-45, 0, 30, 0] }
    const { positions } = buildHorizonCurtain(deep, 1000)
    close(vectorToAzEl([positions[3], positions[4], positions[5]]).elDeg, -46, 1e-4)
  })
})
