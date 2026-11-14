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
  if (!(cellM > 0) || !(sizeM > 0)) throw new Error('Terrain grid has no size')

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
      const y = zM[row * n + col] + observerHeightM
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

  return { positions, indices, halfExtentM: half, minY, maxY }
}

/** Radius of the lunar reference sphere that LOLA heights are measured from. */
export const MOON_RADIUS_M = 1_737_400

/**
 * Fits a coarse regional mesh around the detailed patch: wherever a regional vertex lies inside
 * the patch footprint it is lowered to just below the patch surface, so the detailed terrain is
 * always the one on top there and the two meshes meet without a hole.
 */
export function nestFarMesh(far: TerrainMeshData, near: TerrainMeshData, clearanceM = 25): TerrainMeshData {
  const m = Math.round(Math.sqrt(near.positions.length / 3))
  const x0 = near.positions[0]
  const z0 = near.positions[2]
  const dx = near.positions[3] - x0
  const dz = near.positions[m * 3 + 2] - z0
  const edge = Math.abs(x0)
  const nearY = (i: number, j: number) => near.positions[(j * m + i) * 3 + 1]

  const positions = far.positions.slice()
  let minY = Infinity
  let maxY = -Infinity
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]
    const z = positions[v + 2]
    if (Math.abs(x) <= edge && Math.abs(z) <= edge) {
      const fi = Math.min(Math.max((x - x0) / dx, 0), m - 1)
      const fj = Math.min(Math.max((z - z0) / dz, 0), m - 1)
      const i0 = Math.floor(fi)
      const j0 = Math.floor(fj)
      const i1 = Math.min(i0 + 1, m - 1)
      const j1 = Math.min(j0 + 1, m - 1)
      const ti = fi - i0
      const tj = fj - j0
      const surface = (nearY(i0, j0) * (1 - ti) + nearY(i1, j0) * ti) * (1 - tj) + (nearY(i0, j1) * (1 - ti) + nearY(i1, j1) * ti) * tj
      positions[v + 1] = Math.min(positions[v + 1], surface - clearanceM)
    }
    if (positions[v + 1] < minY) minY = positions[v + 1]
    if (positions[v + 1] > maxY) maxY = positions[v + 1]
  }
  return { ...far, positions, minY, maxY }
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
  const m = Math.round(Math.sqrt(mesh.positions.length / 3))
  // Edge vertices in order: south (west to east), east (south to north), north (east to west), west (north to south).
  const edge: number[] = []
  for (let i = 0; i < m; i++) edge.push(i)
  for (let j = 1; j < m; j++) edge.push(j * m + m - 1)
  for (let i = m - 2; i >= 0; i--) edge.push((m - 1) * m + i)
  for (let j = m - 2; j >= 1; j--) edge.push(j * m)

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
