import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPreparedTerrain, prepareSceneTerrain } from './terrainCache.ts'
import type { PreparedTerrain } from './terrainCache.ts'
import type { TerrainGrid } from './types.ts'

const grid = (sizeM = 100): TerrainGrid => ({ n: 3, sizeM, cellM: sizeM / 3, zM: [0, 1, 2, 1, 2, 3, 2, 3, 4] })
afterEach(() => vi.unstubAllGlobals())

describe('prepared terrain reuse', () => {
  it('reuses mesh buffers on return visits without conflating observer heights or regional grids', () => {
    const near = grid(), far = grid(1000)
    const first = getPreparedTerrain(near, far, 2)
    expect(getPreparedTerrain(near, far, 2)).toBe(first)
    expect(getPreparedTerrain(near, far, 2).meshData.positions).toBe(first.meshData.positions)
    expect(getPreparedTerrain(near, far, 4)).not.toBe(first)
    expect(getPreparedTerrain(near, undefined, 2)).not.toBe(first)
    expect(getPreparedTerrain(near, grid(2000), 2)).not.toBe(first)
  })

  it('deduplicates pending worker jobs and consumes the transferred result directly', async () => {
    const near = grid()
    const prepared: PreparedTerrain = getPreparedTerrain(grid(), undefined, 2)
    const terminate = vi.fn()
    const postMessage = vi.fn()
    let receive: ((event: { data: PreparedTerrain }) => void) | undefined
    const WorkerMock = vi.fn(function () {
      return { set onmessage(callback: typeof receive) { receive = callback }, onerror: null, terminate, postMessage }
    })
    vi.stubGlobal('Worker', WorkerMock)
    const first = prepareSceneTerrain(near, undefined, 2)
    const second = prepareSceneTerrain(near, undefined, 2)
    expect(second).toBe(first)
    expect(WorkerMock).toHaveBeenCalledTimes(1)
    receive?.({ data: prepared })
    expect(await first).toBe(prepared)
    expect(getPreparedTerrain(near, undefined, 2)).toBe(prepared)
    expect(await prepareSceneTerrain(near, undefined, 2)).toBe(prepared)
    expect(WorkerMock).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps terrain usable if workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const terrain = grid()
    const prepared = await prepareSceneTerrain(terrain, undefined, 2)
    expect(getPreparedTerrain(terrain, undefined, 2)).toBe(prepared)
    expect(prepared.meshData.positions.length).toBe(27)
  })
})
