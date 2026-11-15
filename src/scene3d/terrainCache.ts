import { buildTerrainMeshData, nestFarMesh } from './terrainGeometry.ts'
import type { TerrainMeshData } from './terrainGeometry.ts'
import type { TerrainGrid } from './types.ts'

export interface PreparedTerrain { meshData: TerrainMeshData; farMesh: TerrainMeshData | null }
interface Entry { height: number; far?: TerrainGrid; value?: PreparedTerrain; pending?: Promise<PreparedTerrain> }
const cache = new WeakMap<TerrainGrid, Entry[]>()

function entryFor(terrain: TerrainGrid, far: TerrainGrid | undefined, height: number) {
  const entries = cache.get(terrain) ?? []
  let entry = entries.find(item => item.height === height && item.far === far)
  if (!entry) { entry = { height, far }; entries.push(entry); cache.set(terrain, entries) }
  return entry
}

export function getPreparedTerrain(terrain: TerrainGrid, far: TerrainGrid | undefined, height: number): PreparedTerrain {
  const entry = entryFor(terrain, far, height)
  if (!entry.value) {
    const meshData = buildTerrainMeshData(terrain, height)
    entry.value = { meshData, farMesh: far ? nestFarMesh(buildTerrainMeshData(far, height), meshData) : null }
  }
  return entry.value
}

/** Warm selected sites before travel, without clipping regional meshes on the UI thread. */
export function prepareSceneTerrain(terrain: TerrainGrid, far: TerrainGrid | undefined, height: number): Promise<PreparedTerrain> {
  const entry = entryFor(terrain, far, height)
  if (entry.value) return Promise.resolve(entry.value)
  if (entry.pending) return entry.pending
  entry.pending = new Promise<PreparedTerrain>((resolve, reject) => {
    const worker = new Worker(new URL('./terrainPreparation.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<PreparedTerrain | { error: string }>) => {
      worker.terminate()
      if ('error' in event.data) { reject(new Error(event.data.error)); return }
      entry.value ??= event.data
      resolve(entry.value)
    }
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage({ terrain, far, height })
  }).catch(() => getPreparedTerrain(terrain, far, height))
  return entry.pending
}
