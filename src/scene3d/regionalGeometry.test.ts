/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTerrainMeshData, nestFarMesh, terrainBounds, terrainHeightAt, buildPatchSkirt, buildReferenceSphereAroundMesh } from './terrainGeometry.ts'
import type { TerrainMeshData } from './terrainGeometry.ts'
import type { TerrainGrid } from './types.ts'
import { overviewHeightAboveTerrain } from './cameraPlacement.ts'

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
  const originalFineIndices = near.indices.slice(), originalFarIndices = far.indices.slice()
  const ring = nestFarMesh(far, near), p = ring.positions, b = terrainBounds(near), outer = terrainBounds(far)
  const transition = ring.lodTransition!
  expect(transition.method).toMatch(/smoothly decaying/)
  expect(ring.seamIndexStart).toBeUndefined()
  expect(near.positions).toEqual(before)
  expect(far.positions).toEqual(originalFar)
  expect(near.indices).toEqual(originalFineIndices)
  expect(far.indices).toEqual(originalFarIndices)
  expect(ring.positions.subarray(0, originalFar.length)).toEqual(originalFar)
  let projectedArea = 0, transitionArea = 0, overlapArea = 0, invalidWinding = 0, duplicateFaces = 0
  const faces = new Set<string>()
  const edges = new Map<string, { a: number; b: number; count: number }>()
  const parent = Uint32Array.from({ length: p.length / 3 }, (_, i) => i)
  const find = (v: number): number => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v] }; return v }
  const union = (a: number, c: number) => { parent[find(a)] = find(c) }
  const used = new Set<number>(), transitionUsed = new Set<number>()
  const vertexKey = (i: number) => Array.from(p.subarray(i * 3, i * 3 + 3)).join(',')
  const coordinateEdgeKey = (a: number, c: number) => [vertexKey(a), vertexKey(c)].sort().join(';')
  for (let k = 0; k < ring.indices.length; k += 3) {
    const ids = Array.from(ring.indices.subarray(k, k + 3))
    const xyz = ids.map((i) => Array.from(p.subarray(i * 3, i * 3 + 3)))
    const triangle = xyz.map(([x, , z]) => [x, z])
    const faceKey = xyz.map((v) => v.join(',')).sort().join(';')
    if (faces.has(faceKey)) duplicateFaces++
    faces.add(faceKey)
    const a = triangle[0], c = triangle[1], d = triangle[2]
    if ((c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]) <= 0) invalidWinding++
    const triangleArea = area(triangle)
    projectedArea += triangleArea
    if (k >= transition.indexStart) { transitionArea += triangleArea; ids.forEach(id => transitionUsed.add(id)) }
    ids.forEach(id => used.add(id))
    for (let j = 0; j < 3; j++) {
      const av = ids[j], bv = ids[(j + 1) % 3], key = av < bv ? `${av},${bv}` : `${bv},${av}`
      const edge = edges.get(key)
      if (edge) edge.count++
      else edges.set(key, { a: av, b: bv, count: 1 })
      union(av, bv)
    }
    if (!(Math.max(...triangle.map((v) => v[0])) <= b.minX || Math.min(...triangle.map((v) => v[0])) >= b.maxX ||
      Math.max(...triangle.map((v) => v[1])) <= b.minZ || Math.min(...triangle.map((v) => v[1])) >= b.maxZ)) overlapArea += intersectionArea(triangle, b)
  }
  expect(invalidWinding).toBe(0) // In particular, no projected-zero vertical cliff faces remain.
  expect(duplicateFaces).toBe(0)
  expect(new Set([...used].map(find)).size).toBe(1)
  expect(overlapArea).toBeLessThan(0.001)
  const expected = (outer.maxX - outer.minX) * (outer.maxZ - outer.minZ) - (b.maxX - b.minX) * (b.maxZ - b.minZ)
  expect(Math.abs(projectedArea - expected)).toBeLessThan(Math.max(0.01, expected * 1e-7))
  const tb = transition.outerBounds
  const expectedTransitionArea = (tb.maxX - tb.minX) * (tb.maxZ - tb.minZ) - (b.maxX - b.minX) * (b.maxZ - b.minZ)
  expect(Math.abs(transitionArea - expectedTransitionArea)).toBeLessThan(Math.max(0.001, expectedTransitionArea * 1e-7))

  const onBoundary = (i: number, bounds: typeof b) => {
    const x = p[i * 3], z = p[i * 3 + 2], eps = 1e-5
    return x >= bounds.minX - eps && x <= bounds.maxX + eps && z >= bounds.minZ - eps && z <= bounds.maxZ + eps &&
      Math.min(Math.abs(x - bounds.minX), Math.abs(x - bounds.maxX), Math.abs(z - bounds.minZ), Math.abs(z - bounds.maxZ)) < eps
  }
  const sameBoundarySide = (a: number, c: number, bounds: typeof b) => onBoundary(a, bounds) && onBoundary(c, bounds) && (
    Math.abs(p[a * 3] - bounds.minX) < 1e-5 && Math.abs(p[c * 3] - bounds.minX) < 1e-5 ||
    Math.abs(p[a * 3] - bounds.maxX) < 1e-5 && Math.abs(p[c * 3] - bounds.maxX) < 1e-5 ||
    Math.abs(p[a * 3 + 2] - bounds.minZ) < 1e-5 && Math.abs(p[c * 3 + 2] - bounds.minZ) < 1e-5 ||
    Math.abs(p[a * 3 + 2] - bounds.maxZ) < 1e-5 && Math.abs(p[c * 3 + 2] - bounds.maxZ) < 1e-5)
  let invalidEdges = 0
  const innerEdges = new Set<string>()
  for (const { a, b: c, count } of edges.values()) {
    if (count === 1 && sameBoundarySide(a, c, b)) innerEdges.add(coordinateEdgeKey(a, c))
    else if (count !== 2 && !(count === 1 && sameBoundarySide(a, c, outer))) invalidEdges++
  }
  // Every internal edge has two faces; the only open loops are the fine hole and true outer perimeter.
  expect(invalidEdges).toBe(0)
  const nearEdges = new Set<string>()
  const boundary = near.outerBoundaryIndices!
  for (let k = 0; k < boundary.length; k++) {
    const key = (i: number) => Array.from(near.positions.subarray(i * 3, i * 3 + 3)).join(',')
    nearEdges.add([key(boundary[k]), key(boundary[(k + 1) % boundary.length])].sort().join(';'))
  }
  expect(innerEdges).toEqual(nearEdges)

  let maxInnerGap = 0, maxOuterGap = 0
  for (const i of transitionUsed) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
    if (onBoundary(i, b)) maxInnerGap = Math.max(maxInnerGap, Math.abs(y - terrainHeightAt(near, x, z)!))
    if (onBoundary(i, tb)) maxOuterGap = Math.max(maxOuterGap, Math.abs(y - terrainHeightAt(far, x, z)!))
  }
  expect(maxInnerGap).toBeLessThan(0.001)
  expect(maxOuterGap).toBeLessThan(0.001)
  // Independent barycentric samples of rendered faces must also be the camera-clearance surface.
  const triangleCount = transition.indexCount / 3
  for (let s = 0; s < 24; s++) {
    const k = transition.indexStart + Math.floor((triangleCount - 1) * s / 23) * 3
    const ids = Array.from(ring.indices.subarray(k, k + 3))
    const weights = [0.2, 0.3, 0.5]
    const xyz = [0, 1, 2].map(axis => ids.reduce((v, id, j) => v + p[id * 3 + axis] * weights[j], 0))
    expect(terrainHeightAt(ring, xyz[0], xyz[2])).toBeCloseTo(xyz[1], 5)
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

describe('regional mesh with a continuous display transition and exact measured boundaries', () => {
  const data = fileURLToPath(new URL('../../public/data/', import.meta.url))
  const sites = JSON.parse(readFileSync(data + 'sites.json', 'utf8')).sites as { id: string; observerHeightM: number }[]
  for (const site of sites.filter((s) => existsSync(data + s.id + '/terrain-far.json'))) {
    it(`${site.id}: no overlap, holes, vertical walls or duplicate faces; exact fine/coarse boundaries`, () => {
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
  it('smoothly blends a large LOD mismatch and keeps the camera above the rendered annulus', () => {
    const flat = (sizeM: number, height: number) => buildTerrainMeshData({ n: 8, sizeM, cellM: sizeM / 8, zM: Array(64).fill(height - 2) })
    const near = flat(10_000, 300), far = flat(240_000, 0), ring = nestFarMesh(far, near)
    const inner = ring.lodTransition!.innerBounds, outer = ring.lodTransition!.outerBounds
    expect(ring.lodTransition!.samplingM).toBeGreaterThanOrEqual(100)
    expect(ring.lodTransition!.samplingM).toBeLessThanOrEqual(200)
    expect(terrainHeightAt(ring, 0, inner.maxZ)).toBeCloseTo(300, 5)
    expect(terrainHeightAt(ring, 0, (inner.maxZ + outer.maxZ) / 2)).toBeCloseTo(150, 5)
    expect(terrainHeightAt(ring, 0, outer.maxZ)).toBeCloseTo(0, 5)
    expect(overviewHeightAboveTerrain(0, 0, (inner.maxZ + outer.maxZ) / 2, 5, near, ring)).toBeCloseTo(155, 5)
    expect(terrainHeightAt(far, 0, (inner.maxZ + outer.maxZ) / 2)).toBe(0)
  })
})
