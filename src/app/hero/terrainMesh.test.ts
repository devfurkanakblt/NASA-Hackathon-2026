import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildTerrainMesh, decodeHeights, TERRAIN_ORIGIN } from './terrainMesh.ts'
import { MOON_RADIUS_KM } from './descentPath.ts'

const R_M = MOON_RADIUS_KM * 1000
const at = (positions: Float32Array, i: number) => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).add(TERRAIN_ORIGIN)

describe('buildTerrainMesh', () => {
  const n = 8
  const heights = Array.from({ length: n * n }, (_, i) => (i % 7) * 100 - 300)
  const bounds = [-40000, -40000, 40000, 40000]

  it('places every cell centre at its true radius and faces the triangles outwards', () => {
    const mesh = buildTerrainMesh({ heights, n, bounds })
    for (let i = 0; i < n * n; i++) {
      expect((at(mesh.positions, i).length() - 1) * R_M).toBeCloseTo(heights[i], 1)
    }
    for (let k = 0; k < mesh.indices.length; k += 3) {
      const a = at(mesh.positions, mesh.indices[k]), b = at(mesh.positions, mesh.indices[k + 1]), c = at(mesh.positions, mesh.indices[k + 2])
      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      expect(normal.dot(a)).toBeGreaterThan(0)
    }
  })

  it('maps row 0 to the top of the map and adds a lowered skirt', () => {
    const mesh = buildTerrainMesh({ heights, n, bounds, skirtM: 500 })
    expect(mesh.map[1]).toBeGreaterThan(mesh.map[(n * (n - 1)) * 2 + 1]) // row 0 is north (max y)
    const skirtStart = n * n
    expect(mesh.positions.length / 3).toBe(n * n + 4 * (n - 1))
    expect((at(mesh.positions, skirtStart).length() - 1) * R_M).toBeCloseTo(heights[0] - 500, 1)
  })

  it('flattens into the sphere at the feathered rim', () => {
    const mesh = buildTerrainMesh({ heights: new Array(n * n).fill(1000), n, bounds, feather: [10000, 30000] })
    const corner = at(mesh.positions, 0) // ~49 km from the centre, beyond the feather
    expect((corner.length() - 1) * R_M).toBeCloseTo(0, 1)
  })

  it('decodes half-metre int16 heights', () => {
    const raw = new Int16Array([-8000, 0, 3001])
    expect(Array.from(decodeHeights(raw.buffer))).toEqual([-4000, 0, 1500.5])
  })
})
