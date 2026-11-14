import { DEG2RAD } from './coords.ts'
import { terrainHeightAt } from './terrainGeometry.ts'
import type { TerrainMeshData } from './terrainGeometry.ts'
import type { Vec3 } from './types.ts'

/** Prefer the detailed surface inside its footprint; the regional grid is only used outside. */
export function overviewHeightAboveTerrain(x: number, y: number, z: number, clearanceM: number, near?: TerrainMeshData, far?: TerrainMeshData): number {
  const terrainY = (near && terrainHeightAt(near, x, z)) ?? (far && terrainHeightAt(far, x, z))
  return terrainY === undefined ? y : Math.max(y, terrainY + clearanceM)
}

export function overviewStartPosition(halfExtentM: number, sunAzDeg: number, near?: TerrainMeshData, far?: TerrainMeshData): Vec3 {
  const behind = (sunAzDeg + 180 + 12) * DEG2RAD
  const distance = halfExtentM * 2.3
  const x = Math.sin(behind) * distance, z = -Math.cos(behind) * distance
  return [x, overviewHeightAboveTerrain(x, halfExtentM * 0.5, z, Math.max(5, halfExtentM * 0.01), near, far), z]
}
