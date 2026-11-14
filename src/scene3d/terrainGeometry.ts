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
