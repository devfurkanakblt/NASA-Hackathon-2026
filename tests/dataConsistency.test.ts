/// <reference types="node" />
/**
 * Cross-check between the two files the 3D view puts on screen together:
 * the terrain mesh built from `terrain.json` and the horizon profile in `horizon.json`.
 *
 * Wherever the horizon is formed by terrain inside the 3D patch, the skyline of the mesh —
 * measured from the observer eye exactly as the scene draws it — must agree with the profile.
 * A swapped axis or flipped row order in the 3D view would break this by degrees.
 *
 * Both files come from the same DEMs, but the mesh is a ~39 m cell mean and the profile is
 * traced on the 5 m data, so agreement is expected to a few tenths of a degree, not exactly.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEG2RAD, RAD2DEG } from '../src/scene3d/coords.ts'
import { buildTerrainMeshData } from '../src/scene3d/terrainGeometry.ts'
import type { HorizonProfile, TerrainGrid } from '../src/scene3d/types.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T

interface SitesDoc {
  sites: { id: string; observerHeightM: number }[]
}

/** Horizon-forming terrain must lie inside the patch and beyond the mesh's smoothing scale. */
const MIN_DISTANCE_M = 400
const MAX_DISTANCE_M = 4400
const MIN_RELIEF_FOR_CONTROL_DEG = 1.0

/** Elevation of the mesh skyline at an azimuth, seen from the eye. `mirror` flips north/south. */
function meshSkylineDeg(mesh: ReturnType<typeof buildTerrainMeshData>, eyeHeightM: number, azDeg: number, mirror = false): number {
  const { positions } = mesh
  const m = Math.round(Math.sqrt(positions.length / 3))
  const x0 = positions[0]
  const z0 = positions[2]
  const dx = positions[3] - x0
  const dz = positions[m * 3 + 2] - z0
  const heightAt = (x: number, z: number) => {
    const fi = Math.min(Math.max((x - x0) / dx, 0), m - 1)
    const fj = Math.min(Math.max((z - z0) / dz, 0), m - 1)
    const i0 = Math.floor(fi)
    const j0 = Math.floor(fj)
    const i1 = Math.min(i0 + 1, m - 1)
    const j1 = Math.min(j0 + 1, m - 1)
    const ti = fi - i0
    const tj = fj - j0
    const y = (i: number, j: number) => positions[(j * m + i) * 3 + 1]
    return (y(i0, j0) * (1 - ti) + y(i1, j0) * ti) * (1 - tj) + (y(i0, j1) * (1 - ti) + y(i1, j1) * ti) * tj
  }
  const east = Math.sin(azDeg * DEG2RAD)
  const north = Math.cos(azDeg * DEG2RAD) * (mirror ? -1 : 1)
  let best = -Infinity
  for (let s = 80; s <= MAX_DISTANCE_M + 400; s += 20) {
    const el = Math.atan2(heightAt(east * s, -north * s) - eyeHeightM, s)
    if (el > best) best = el
  }
  return best * RAD2DEG
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

describe('terrain mesh vs horizon profile (public/data)', () => {
  const { sites } = read<SitesDoc>('sites.json')
  let sitesCompared = 0

  for (const site of sites) {
    it(`${site.id}: mesh skyline matches the horizon profile where local terrain forms it`, () => {
      const terrain = read<TerrainGrid>(`${site.id}/terrain.json`)
      const horizon = read<HorizonProfile>(`${site.id}/horizon.json`)
      const mesh = buildTerrainMeshData(terrain, site.observerHeightM)

      const diffs: number[] = []
      const mirrored: number[] = []
      const step = Math.round(1 / horizon.azStepDeg)
      for (let i = 0; i < horizon.elevDeg.length; i += step) {
        const distance = horizon.distanceM?.[i]
        if (distance === undefined || distance < MIN_DISTANCE_M || distance > MAX_DISTANCE_M) continue
        const az = i * horizon.azStepDeg
        diffs.push(Math.abs(meshSkylineDeg(mesh, site.observerHeightM, az) - horizon.elevDeg[i]))
        mirrored.push(Math.abs(meshSkylineDeg(mesh, site.observerHeightM, az, true) - horizon.elevDeg[i]))
      }

      // Sites whose horizon is formed entirely by distant (or very near) terrain have nothing to compare.
      if (diffs.length < 5) return
      sitesCompared++
      expect(median(diffs)).toBeLessThan(0.15)
      expect(Math.max(...diffs)).toBeLessThan(0.5)
      // Negative control: the same mesh mirrored north–south must be clearly worse. It can only
      // discriminate where the local skyline varies; on flat ground (e.g. the CE6 mare site, 0.18 deg
      // spread) the mirrored skyline is nearly identical, so the control is skipped there.
      const compared = horizon.elevDeg.filter((_, i) => {
        const d = horizon.distanceM?.[i]
        return i % step === 0 && d !== undefined && d >= MIN_DISTANCE_M && d <= MAX_DISTANCE_M
      })
      if (Math.max(...compared) - Math.min(...compared) >= MIN_RELIEF_FOR_CONTROL_DEG) {
        expect(median(mirrored)).toBeGreaterThan(3 * median(diffs) + 0.2)
      }
    })
  }

  it('had enough local-horizon azimuths to make the comparison meaningful', () => {
    expect(sitesCompared).toBeGreaterThanOrEqual(2)
  })
})
