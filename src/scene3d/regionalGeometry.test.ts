/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTerrainMeshData, nestFarMesh, terrainBounds, terrainHeightAt, buildPatchSkirt, buildReferenceSphereAroundMesh } from './terrainGeometry.ts'
import type { TerrainMeshData } from './terrainGeometry.ts'
import type { TerrainGrid } from './types.ts'

const area = (p: number[][]) => Math.abs(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0] }, 0)) / 2

/** Independent 2D rectangle intersection; it ignores height and checks actual triangle coverage. */
function intersectionArea(triangle: number[][], b: ReturnType<typeof terrainBounds>): number {
  let polygon = triangle
  for (const [axis, value, sign] of [[0, b.minX, 1], [0, b.maxX, -1], [1, b.minZ, 1], [1, b.maxZ, -1]]) {
    const out: number[][] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], c = polygon[(i + 1) % polygon.length]
      const da = sign * (a[axis] - value), dc = sign * (c[axis] - value)
      if (da >= 0) out.push(a)
      if ((da >= 0) !== (dc >= 0)) { const t = da / (da - dc); out.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]) }
    }
    polygon = out
  }
  return polygon.length < 3 ? 0 : area(polygon)
}

function checkRing(near: TerrainMeshData, far: TerrainMeshData) {
  const before = near.positions.slice(), originalFar = far.positions.slice()
  const ring = nestFarMesh(far, near), p = ring.positions, b = terrainBounds(near), outer = terrainBounds(far)
  expect(near.positions).toEqual(before)
  expect(ring.positions.subarray(0, originalFar.length)).toEqual(originalFar)
  let projectedArea = 0, overlapArea = 0
  const faces = new Set<string>()
  for (let k = 0; k < ring.seamIndexStart!; k += 3) {
    const ids = Array.from(ring.indices.subarray(k, k + 3))
    const xyz = ids.map((i) => Array.from(p.subarray(i * 3, i * 3 + 3)))
    const triangle = xyz.map(([x, , z]) => [x, z])
    const faceKey = xyz.map((v) => v.join(',')).sort().join(';')
    expect(faces.has(faceKey)).toBe(false)
    faces.add(faceKey)
    const a = triangle[0], c = triangle[1], d = triangle[2]
    expect((c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1])).toBeGreaterThan(0)
    projectedArea += area(triangle)
    if (!(Math.max(...triangle.map((v) => v[0])) <= b.minX || Math.min(...triangle.map((v) => v[0])) >= b.maxX ||
      Math.max(...triangle.map((v) => v[1])) <= b.minZ || Math.min(...triangle.map((v) => v[1])) >= b.maxZ)) overlapArea += intersectionArea(triangle, b)
  }
  expect(overlapArea).toBeLessThan(0.001)
  const expected = (outer.maxX - outer.minX) * (outer.maxZ - outer.minZ) - (b.maxX - b.minX) * (b.maxZ - b.minZ)
  expect(Math.abs(projectedArea - expected)).toBeLessThan(Math.max(0.01, expected * 1e-7))

  const seamVertices = new Set<number>()
  for (let k = ring.seamIndexStart!; k < ring.indices.length; k += 3) {
    const ids = Array.from(ring.indices.subarray(k, k + 3))
    ids.forEach((i) => seamVertices.add(i))
    const triangle = ids.map((i) => [p[i * 3], p[i * 3 + 2]])
    expect(area(triangle)).toBeLessThan(1e-5)
    for (const [x, z] of triangle) expect(Math.min(Math.abs(x - b.minX), Math.abs(x - b.maxX), Math.abs(z - b.minZ), Math.abs(z - b.maxZ))).toBeLessThan(1e-5)
  }
  // Every fine boundary height is carried to the join, and every join vertex lies on one
  // of the two measured boundary curves (not an arbitrary lowered synthetic surface).
  for (const i of seamVertices) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
    expect(Math.min(Math.abs(y - terrainHeightAt(near, x, z)!), Math.abs(y - terrainHeightAt(far, x, z)!))).toBeLessThan(0.002)
  }
  const keys = new Set([...seamVertices].map((i) => `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`))
  for (const i of near.outerBoundaryIndices!) {
    const key = Array.from(near.positions.subarray(i * 3, i * 3 + 3)).join(',')
    // Equal LOD heights need no vertical face.
    if (Math.abs(near.positions[i * 3 + 1] - terrainHeightAt(far, near.positions[i * 3], near.positions[i * 3 + 2])!) > 0.002) expect(keys.has(key)).toBe(true)
  }
  expect(ring.outerBoundaryIndices).toEqual(far.outerBoundaryIndices)
  const skirt = buildPatchSkirt(ring, 1000)
  expect(skirt.positions.length).toBe((far.outerBoundaryIndices!.length + 1) * 6)
  const sphere = buildReferenceSphereAroundMesh(ring, 1000, 350_000, 2)
  for (let i = 0; i < sphere.positions.length; i += 3) {
    const x = sphere.positions[i], z = sphere.positions[i + 2]
    expect(x <= outer.minX + 0.02 || x >= outer.maxX - 0.02 || z <= outer.minZ + 0.02 || z >= outer.maxZ - 0.02).toBe(true)
  }
  return ring
}

describe('regional mesh with a real hole and exact measured seam', () => {
  const data = fileURLToPath(new URL('../../public/data/', import.meta.url))
  const sites = JSON.parse(readFileSync(data + 'sites.json', 'utf8')).sites as { id: string; observerHeightM: number }[]
  for (const site of sites.filter((s) => existsSync(data + s.id + '/terrain-far.json'))) {
    it(`${site.id}: no coarse triangles cover the fine DEM, no double faces, continuous boundary`, () => {
      const read = (name: string): TerrainGrid => JSON.parse(readFileSync(data + site.id + '/' + name, 'utf8'))
      checkRing(buildTerrainMeshData(read('terrain.json'), site.observerHeightM), buildTerrainMeshData(read('terrain-far.json'), site.observerHeightM))
    })
  }
  it('works with non-divisible grid spacings and an asymmetric rounded footprint', () => {
    const grid = (n: number, sizeM: number, cellM: number): TerrainGrid => ({ n, sizeM, cellM,
      zM: Array.from({ length: n * n }, (_, i) => Math.sin(i * 2.3) * 45 - 2) })
    checkRing(buildTerrainMeshData(grid(7, 27, 3.856)), buildTerrainMeshData(grid(8, 100, 12.5)))
  })
  it('rejects a regional grid that does not surround the detailed patch', () => {
    const m = buildTerrainMeshData({ n: 3, sizeM: 30, cellM: 10, zM: Array(9).fill(-2) })
    expect(() => nestFarMesh(m, m)).toThrow(/surround/)
  })
})
