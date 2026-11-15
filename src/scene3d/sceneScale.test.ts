/// <reference types="node" />
/** Every catalogue place's real terrain must give a 3D view: the reference sphere must build. */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SitesDoc } from '../data/contract.ts'
import { buildReferenceSphereAroundMesh, buildTerrainMeshData, nestFarMesh } from './terrainGeometry.ts'
import { REFERENCE_SPHERE_RADIUS, sceneHalfExtent } from './sceneScale.ts'
import type { TerrainGrid } from './types.ts'

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const sites = read<SitesDoc>('sites.json').sites

describe('sceneHalfExtent', () => {
  it('keeps the usual 10 km patch scale and grows only for narrow near patches', () => {
    expect(sceneHalfExtent(5000, 240_000)).toBe(5000)
    expect(sceneHalfExtent(2000, 240_000)).toBe(5000)
    expect(sceneHalfExtent(5000)).toBe(5000)
  })

  it('builds the reference sphere for every catalogue place (IM-1 has a 4 km near patch)', () => {
    for (const site of sites) {
      const root = `${site.id}/`
      if (!existsSync(DATA + root + 'terrain.json')) continue
      const near = read<TerrainGrid>(root + 'terrain.json')
      const far = existsSync(DATA + root + 'terrain-far.json') ? read<TerrainGrid>(root + 'terrain-far.json') : undefined
      const meshData = buildTerrainMeshData(near, site.observerHeightM)
      const farMesh = far ? nestFarMesh(buildTerrainMeshData(far, site.observerHeightM), meshData) : null
      const outer = sceneHalfExtent(meshData.halfExtentM, far?.sizeM) * REFERENCE_SPHERE_RADIUS
      expect(() => buildReferenceSphereAroundMesh(farMesh ?? meshData, site.surfaceElevationM, outer), site.id).not.toThrow()
    }
  })
})
