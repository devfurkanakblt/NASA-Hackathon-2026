import { OBSERVER_HEIGHT_M, azElToUnitVector } from './coords.ts'
import type { HorizonProfile, TerrainGrid, Vec3 } from './types.ts'

export interface TerrainMeshData {
  /** xyz per vertex in the scene frame (+X east, +Y up, −Z north), origin on the ground at the site. */
  positions: Float32Array
  indices: Uint32Array
  /** Half the side of the patch, in metres. */
  halfExtentM: number
  minY: number
  maxY: number
  /** Original square grid at the start of positions; clipping may append vertices. */
  gridSize?: number
  /** Ordered measured outer perimeter, independent of any clipped interior hole. */
  outerBoundaryIndices?: Uint32Array
  /** Indices from here onward join the two measured LOD boundaries vertically. */
  seamIndexStart?: number
}

/** Evenly spaced sample indices 0 … last, always including both ends. */
function sampleIndices(count: number, maxSegments: number): number[] {
  const last = count - 1
  const segments = Math.max(1, Math.min(last, maxSegments))
  const out: number[] = []
  for (let i = 0; i <= segments; i++) out.push(Math.round((i * last) / segments))
  return out
}

/**
 * Mesh of the local terrain from a contract `terrain.json` grid.
 * Grid heights are relative to the observer eye; the scene origin is the ground under it,
 * so every height is lifted by the observer height. Row 0 is south (+Z), column 0 west (−X);
 * triangles face up.
 */
export function buildTerrainMeshData(grid: TerrainGrid, observerHeightM = OBSERVER_HEIGHT_M, maxSegments = 256): TerrainMeshData {
  const { n, cellM, sizeM, zM } = grid
  if (!Number.isInteger(n) || n < 2) throw new Error('Terrain grid needs at least 2 × 2 cells')
  if (!zM || zM.length < n * n) throw new Error('Terrain grid has fewer heights than n × n')
  if (!Number.isFinite(cellM) || !Number.isFinite(sizeM) || !(cellM > 0) || !(sizeM > 0)) throw new Error('Terrain grid has no finite size')
  if (!Number.isFinite(observerHeightM)) throw new Error('Observer height must be finite')

  const idx = sampleIndices(n, maxSegments)
  const m = idx.length
  const half = sizeM / 2

  const positions = new Float32Array(m * m * 3)
  let minY = Infinity
  let maxY = -Infinity
  let p = 0
  for (let j = 0; j < m; j++) {
    const row = idx[j]
    const north = (row + 0.5) * cellM - half
    for (let i = 0; i < m; i++) {
      const col = idx[i]
      const height = zM[row * n + col]
      if (typeof height !== 'number' || !Number.isFinite(height)) throw new Error('Terrain grid contains a missing or non-finite height')
      const y = height + observerHeightM
      positions[p++] = (col + 0.5) * cellM - half
      positions[p++] = y
      positions[p++] = -north
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const indices = new Uint32Array((m - 1) * (m - 1) * 6)
  let q = 0
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i
      const b = a + 1
      const c = a + m
      const d = c + 1
      indices[q++] = a
      indices[q++] = b
      indices[q++] = c
      indices[q++] = b
      indices[q++] = d
      indices[q++] = c
    }
  }

  return { positions, indices, halfExtentM: half, minY, maxY, gridSize: m, outerBoundaryIndices: gridBoundary(m) }
}

function gridBoundary(m: number): Uint32Array {
  const edge: number[] = []
  for (let i = 0; i < m; i++) edge.push(i)
  for (let j = 1; j < m; j++) edge.push(j * m + m - 1)
  for (let i = m - 2; i >= 0; i--) edge.push((m - 1) * m + i)
  for (let j = m - 2; j >= 1; j--) edge.push(j * m)
  return Uint32Array.from(edge)
}

export function terrainBounds(mesh: TerrainMeshData) {
  const m = mesh.gridSize ?? Math.round(Math.sqrt(mesh.positions.length / 3))
  return { minX: mesh.positions[0], maxX: mesh.positions[(m - 1) * 3],
    minZ: mesh.positions[(m - 1) * m * 3 + 2], maxZ: mesh.positions[2] }
}

/** Height of the actual grid triangles, not a bilinear surface or a flattened DEM. */
export function terrainHeightAt(mesh: TerrainMeshData, x: number, z: number): number | undefined {
  const m = mesh.gridSize ?? Math.round(Math.sqrt(mesh.positions.length / 3))
  const p = mesh.positions
  const b = terrainBounds(mesh)
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return undefined
  const locate = (value: number, at: (i: number) => number) => {
    let lo = 0, hi = m - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at(mid) <= value) lo = mid; else hi = mid }
    return Math.min(lo, m - 2)
  }
  const i = locate(x, (k) => p[k * 3])
  const j = locate(-z, (k) => -p[k * m * 3 + 2])
  const a = (j * m + i) * 3, bb = a + 3, c = a + m * 3, d = c + 3
  const u = (x - p[a]) / (p[bb] - p[a]), v = (z - p[a + 2]) / (p[c + 2] - p[a + 2])
  return u + v <= 1 ? p[a + 1] + (p[bb + 1] - p[a + 1]) * u + (p[c + 1] - p[a + 1]) * v
    : p[d + 1] + (p[c + 1] - p[d + 1]) * (1 - u) + (p[bb + 1] - p[d + 1]) * (1 - v)
}

/** Radius of the lunar reference sphere that LOLA heights are measured from. */
export const MOON_RADIUS_M = 1_737_400

/**
 * Subtract the detailed footprint from each coarse triangle. No DEM heights are lowered or
 * invented. Vertical seam faces join the two measured boundaries; they have zero map area.
 * The original coarse grid stays at the beginning of positions for height queries and its
 * measured outer perimeter is retained for the reference-sphere boundary.
 */
export function nestFarMesh(far: TerrainMeshData, near: TerrainMeshData): TerrainMeshData {
  const bounds = terrainBounds(near), outer = terrainBounds(far)
  if (!(outer.minX < bounds.minX && outer.maxX > bounds.maxX && outer.minZ < bounds.minZ && outer.maxZ > bounds.maxZ)) {
    throw new Error('Regional terrain must surround the detailed terrain footprint')
  }
  const positions = Array.from(far.positions), indices: number[] = []
  const vertices = new Map<string, number>()
  const add = (v: Vec3) => {
    const f = v.map(Math.fround), key = f.join(',')
    let index = vertices.get(key)
    if (index === undefined) { index = positions.length / 3; positions.push(...f); vertices.set(key, index) }
    return index
  }
  for (let i = 0; i < far.positions.length; i += 3) vertices.set(`${far.positions[i]},${far.positions[i + 1]},${far.positions[i + 2]}`, i / 3)
  const vertex = (index: number): Vec3 => [far.positions[index * 3], far.positions[index * 3 + 1], far.positions[index * 3 + 2]]
  const clip = (poly: Vec3[], axis: 0 | 2, value: number, less: boolean): Vec3[] => {
    const result: Vec3[] = []
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length]
      const insideA = less ? a[axis] <= value : a[axis] >= value
      const insideB = less ? b[axis] <= value : b[axis] >= value
      if (insideA) result.push(a)
      if (insideA !== insideB) {
        const f = (value - a[axis]) / (b[axis] - a[axis])
        const hit: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
        hit[axis] = value
        result.push(hit)
      }
    }
    return result
  }
  const emit = (poly: Vec3[]) => {
    for (let k = 1; k + 1 < poly.length; k++) {
      const [a, b, c] = [poly[0], poly[k], poly[k + 1]]
      if (Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) > 1e-6) indices.push(add(a), add(b), add(c))
    }
  }
  const planes: [0 | 2, number, boolean][] = [[0, bounds.minX, false], [0, bounds.maxX, true], [2, bounds.minZ, false], [2, bounds.maxZ, true]]
  for (let i = 0; i < far.indices.length; i += 3) {
    let polygon = [vertex(far.indices[i]), vertex(far.indices[i + 1]), vertex(far.indices[i + 2])]
    for (const [axis, value, insideLess] of planes) {
      emit(clip(polygon, axis, value, !insideLess))
      polygon = clip(polygon, axis, value, insideLess)
      if (polygon.length === 0) break
    }
  }
  const seamIndexStart = indices.length
  // Include every fine edge vertex and every clipped coarse triangle intersection. This
  // keeps both piecewise-linear boundary curves, even when the grid spacings do not divide.
  const sides = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()]
  const collect = (x: number, z: number) => {
    if (Math.abs(z - bounds.maxZ) < 1e-5 && x >= bounds.minX && x <= bounds.maxX) sides[0].add(x)
    if (Math.abs(x - bounds.maxX) < 1e-5 && z >= bounds.minZ && z <= bounds.maxZ) sides[1].add(-z)
    if (Math.abs(z - bounds.minZ) < 1e-5 && x >= bounds.minX && x <= bounds.maxX) sides[2].add(-x)
    if (Math.abs(x - bounds.minX) < 1e-5 && z >= bounds.minZ && z <= bounds.maxZ) sides[3].add(z)
  }
  for (const i of near.outerBoundaryIndices ?? gridBoundary(near.gridSize ?? Math.round(Math.sqrt(near.positions.length / 3)))) collect(near.positions[i * 3], near.positions[i * 3 + 2])
  for (let i = 0; i < positions.length; i += 3) collect(positions[i], positions[i + 2])
  for (let side = 0; side < 4; side++) {
    const ts = [...sides[side]].sort((a, b) => a - b)
    const point = (t: number): [number, number] => side === 0 ? [t, bounds.maxZ] : side === 1 ? [bounds.maxX, -t] : side === 2 ? [-t, bounds.minZ] : [bounds.minX, t]
    for (let k = 0; k + 1 < ts.length; k++) {
      const [ax, az] = point(ts[k]), [bx, bz] = point(ts[k + 1])
      const a = add([ax, terrainHeightAt(near, ax, az)!, az]), b = add([ax, terrainHeightAt(far, ax, az)!, az])
      const c = add([bx, terrainHeightAt(near, bx, bz)!, bz]), d = add([bx, terrainHeightAt(far, bx, bz)!, bz])
      if (a !== b) indices.push(a, b, c)
      if (c !== d) indices.push(c, b, d)
    }
  }
  let minY = Infinity, maxY = -Infinity
  for (let i = 1; i < positions.length; i += 3) { minY = Math.min(minY, positions[i]); maxY = Math.max(maxY, positions[i]) }
  return { ...far, positions: Float32Array.from(positions), indices: Uint32Array.from(indices), seamIndexStart, minY, maxY,
    outerBoundaryIndices: far.outerBoundaryIndices ?? gridBoundary(far.gridSize ?? Math.round(Math.sqrt(far.positions.length / 3))) }
}

/** Scene height of the reference sphere at horizontal distance `r` from the site. */
export function referenceSphereY(r: number, siteElevationM: number): number {
  return -siteElevationM - (MOON_RADIUS_M - Math.sqrt(MOON_RADIUS_M * MOON_RADIUS_M - r * r))
}

/**
 * Vertical faces along the edge of the terrain patch, joining it to the reference sphere,
 * so the patch reads as a block cut out of the Moon rather than a sheet floating above it.
 */
export function buildPatchSkirt(mesh: TerrainMeshData, siteElevationM: number): { positions: Float32Array; indices: Uint32Array } {
  const edge = mesh.outerBoundaryIndices ?? gridBoundary(mesh.gridSize ?? Math.round(Math.sqrt(mesh.positions.length / 3)))

  const n = edge.length
  const positions = new Float32Array((n + 1) * 2 * 3)
  for (let k = 0; k <= n; k++) {
    const v = edge[k % n] * 3
    const x = mesh.positions[v]
    const z = mesh.positions[v + 2]
    positions.set([x, mesh.positions[v + 1], z, x, referenceSphereY(Math.hypot(x, z), siteElevationM), z], k * 6)
  }
  const indices = new Uint32Array(n * 6)
  for (let k = 0; k < n; k++) {
    const t0 = k * 2
    indices.set([t0, t0 + 1, t0 + 2, t0 + 2, t0 + 1, t0 + 3], k * 6)
  }
  return { positions, indices }
}

/** Datum surface strictly outside the measured perimeter, including a clipped regional mesh. */
export function buildReferenceSphereAroundMesh(mesh: TerrainMeshData, siteElevationM: number, outerRadiusM: number, rings = 16) {
  const boundary = mesh.outerBoundaryIndices ?? gridBoundary(mesh.gridSize ?? Math.round(Math.sqrt(mesh.positions.length / 3)))
  const count = boundary.length
  const positions = new Float32Array((count + 1) * (rings + 1) * 3)
  const indices = new Uint32Array(count * rings * 6)
  for (let k = 0; k <= count; k++) {
    const i = boundary[k % count] * 3, x = mesh.positions[i], z = mesh.positions[i + 2]
    const inner = Math.hypot(x, z)
    if (!(outerRadiusM > inner && outerRadiusM < MOON_RADIUS_M)) throw new Error('Reference sphere radius must surround measured terrain and stay below the lunar radius')
    for (let j = 0; j <= rings; j++) {
      const r = inner + (outerRadiusM - inner) * (j / rings) ** 2.2
      positions.set([x * r / inner, referenceSphereY(r, siteElevationM), z * r / inner], (k * (rings + 1) + j) * 3)
    }
  }
  for (let k = 0; k < count; k++) for (let j = 0; j < rings; j++) {
    const a = k * (rings + 1) + j, b = a + 1, c = a + rings + 1, d = c + 1
    indices.set([a, b, c, b, d, c], (k * rings + j) * 6)
  }
  return { positions, indices }
}

/**
 * The smooth lunar reference sphere around the square terrain patch, out to `outerRadiusM`.
 * It is not terrain: it is the datum the heights are measured from, drawn so that the overview
 * has the Moon's real curvature and limb beyond the patch instead of empty space.
 * `siteElevationM` is the height of the ground at the site above that sphere.
 */
export function buildReferenceSphereRing(
  halfExtentM: number,
  siteElevationM: number,
  outerRadiusM: number,
  segments = 128,
  rings = 40,
): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((segments + 1) * (rings + 1) * 3)
  const indices = new Uint32Array(segments * rings * 6)
  let p = 0
  for (let k = 0; k <= segments; k++) {
    const theta = (k / segments) * Math.PI * 2
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const inner = halfExtentM / Math.max(Math.abs(sin), Math.abs(cos)) // edge of the square patch
    for (let j = 0; j <= rings; j++) {
      const r = inner + (outerRadiusM - inner) * (j / rings) ** 2.2
      positions[p++] = r * sin
      positions[p++] = referenceSphereY(r, siteElevationM)
      positions[p++] = -r * cos
    }
  }
  let q = 0
  for (let k = 0; k < segments; k++) {
    for (let j = 0; j < rings; j++) {
      const a = k * (rings + 1) + j
      const b = a + 1
      const c = a + rings + 1
      const d = c + 1
      indices[q++] = a
      indices[q++] = c
      indices[q++] = b
      indices[q++] = b
      indices[q++] = c
      indices[q++] = d
    }
  }
  return { positions, indices }
}

/** Points of the terrain-horizon line on a sphere of `radius` around the observer. */
export function horizonLinePoints(profile: HorizonProfile, radius: number): Vec3[] {
  const n = profile.elevDeg.length
  const points: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const [x, y, z] = azElToUnitVector(i * profile.azStepDeg, profile.elevDeg[i % n])
    points.push([x * radius, y * radius, z * radius])
  }
  return points
}

/** Points of a constant-elevation circle (e.g. the geometric horizon) around the observer. */
export function elevationCirclePoints(elDeg: number, radius: number, stepDeg = 1): Vec3[] {
  const points: Vec3[] = []
  for (let az = 0; az <= 360; az += stepDeg) {
    const [x, y, z] = azElToUnitVector(az, elDeg)
    points.push([x * radius, y * radius, z * radius])
  }
  return points
}

/**
 * "Curtain" that fills the sky below the terrain horizon, seen from the observer.
 * It stands in for all terrain out to the scan distance, which the local mesh does not cover,
 * so the silhouette in the lander view is exactly the profile used by the calculations.
 */
export function buildHorizonCurtain(
  profile: HorizonProfile,
  radius: number,
  bottomElDeg = -40,
): { positions: Float32Array; indices: Uint32Array } {
  const n = profile.elevDeg.length
  const positions = new Float32Array((n + 1) * 2 * 3)
  const indices = new Uint32Array(n * 6)
  for (let i = 0; i <= n; i++) {
    const az = i * profile.azStepDeg
    const el = profile.elevDeg[i % n]
    const top = azElToUnitVector(az, el)
    const bottom = azElToUnitVector(az, Math.min(bottomElDeg, el - 1))
    positions.set([top[0] * radius, top[1] * radius, top[2] * radius], i * 6)
    positions.set([bottom[0] * radius, bottom[1] * radius, bottom[2] * radius], i * 6 + 3)
  }
  for (let i = 0; i < n; i++) {
    const t0 = i * 2
    const b0 = t0 + 1
    const t1 = t0 + 2
    const b1 = t0 + 3
    indices.set([t0, b0, t1, t1, b0, b1], i * 6)
  }
  return { positions, indices }
}
