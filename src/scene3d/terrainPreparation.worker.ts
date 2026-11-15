import { buildTerrainMeshData, nestFarMesh } from './terrainGeometry.ts'
import type { TerrainGrid } from './types.ts'
import type { PreparedTerrain } from './terrainCache.ts'

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ terrain: TerrainGrid; far?: TerrainGrid; height: number }>) => void
  postMessage: (value: PreparedTerrain | { error: string }, transfer?: Transferable[]) => void
}
scope.onmessage = ({ data: { terrain, far, height } }) => {
  try {
    const meshData = buildTerrainMeshData(terrain, height)
    const farMesh = far ? nestFarMesh(buildTerrainMeshData(far, height), meshData) : null
    const buffers = new Set<ArrayBuffer>()
    for (const mesh of [meshData, farMesh]) {
      if (!mesh) continue
      for (const view of [mesh.positions, mesh.indices, mesh.outerBoundaryIndices]) {
        if (view) buffers.add(view.buffer as ArrayBuffer)
      }
    }
    scope.postMessage({ meshData, farMesh }, [...buffers])
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
