import { mapToDirection, MOON_RADIUS_KM } from './descentPath.ts'
import { Vector3 } from 'three'

const R_M = MOON_RADIUS_KM * 1000

/** Mesh origin in the Moon frame: the south pole. Vertices are stored relative to it for precision. */
export const TERRAIN_ORIGIN = new Vector3(0, -1, 0)

export interface TerrainMeshInput {
  /** Row-major heights in metres above the 1737.4 km sphere; row 0 = max y. */
  heights: ArrayLike<number>
  n: number
  /** [left, bottom, right, top] in stereographic metres. */
  bounds: number[]
  /** Drop a skirt this far below the border, hiding cracks against a coarser mesh. */
  skirtM?: number
  /** Blend heights to 0 between these map radii (m), so the edge meets the reference sphere. */
  feather?: [number, number]
}

export interface TerrainMeshData {
  positions: Float32Array
  /** Stereographic x, y per vertex (metres), for texture lookups and clipping. */
  map: Float32Array
  indices: Uint32Array
}

/** Decode int16 little-endian half-metre heights (see preprocess/hero_terrain.py). */
export function decodeHeights(buffer: ArrayBuffer): Float32Array {
  const raw = new Int16Array(buffer)
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] * 0.5
  return out
}

/**
 * A regular grid on the curved surface: each cell centre is placed at its true lunar position
 * and height, so curvature and relief are exact at the grid spacing.
 */
export function buildTerrainMesh({ heights, n, bounds, skirtM = 0, feather }: TerrainMeshInput): TerrainMeshData {
  const [left, , right, top] = bounds
  const cell = (right - left) / n
  const ring = skirtM > 0 ? 4 * (n - 1) : 0
  const count = n * n + ring
  const positions = new Float32Array(count * 3)
  const map = new Float32Array(count * 2)
  const dir = new Vector3()

  const place = (index: number, x: number, y: number, h: number) => {
    mapToDirection(x, y, dir).multiplyScalar(1 + h / R_M).sub(TERRAIN_ORIGIN)
    positions[index * 3] = dir.x
    positions[index * 3 + 1] = dir.y
    positions[index * 3 + 2] = dir.z
    map[index * 2] = x
    map[index * 2 + 1] = y
  }
  const heightAt = (row: number, col: number, x: number, y: number) => {
    let h = heights[row * n + col]
    if (feather) {
      const t = Math.min(1, Math.max(0, (Math.hypot(x, y) - feather[0]) / (feather[1] - feather[0])))
      h *= 1 - t * t * (3 - 2 * t)
    }
    return h
  }

  for (let row = 0; row < n; row++) {
    const y = top - (row + 0.5) * cell
    for (let col = 0; col < n; col++) {
      const x = left + (col + 0.5) * cell
      place(row * n + col, x, y, heightAt(row, col, x, y))
    }
  }

  const quads = (n - 1) * (n - 1) + ring
  const indices = new Uint32Array(quads * 6)
  let k = 0
  const quad = (a: number, b: number, c: number, d: number) => {
    // a b / c d, wound so the face normal points away from the Moon
    indices[k++] = a; indices[k++] = c; indices[k++] = b
    indices[k++] = b; indices[k++] = c; indices[k++] = d
  }
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col
      quad(a, a + 1, a + n, a + n + 1)
    }
  }

  if (ring) {
    // Border loop, clockwise on the map, each vertex duplicated skirtM lower.
    const border: number[] = []
    for (let col = 0; col < n - 1; col++) border.push(col)
    for (let row = 0; row < n - 1; row++) border.push(row * n + n - 1)
    for (let col = n - 1; col > 0; col--) border.push((n - 1) * n + col)
    for (let row = n - 1; row > 0; row--) border.push(row * n)
    border.forEach((top, i) => {
      const x = map[top * 2], y = map[top * 2 + 1]
      const row = Math.floor(top / n), col = top % n
      place(n * n + i, x, y, heightAt(row, col, x, y) - skirtM)
    })
    for (let i = 0; i < border.length; i++) {
      const j = (i + 1) % border.length
      quad(border[j], border[i], n * n + j, n * n + i) // faces outwards from the patch
    }
  }
  return { positions, map, indices }
}
