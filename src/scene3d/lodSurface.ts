/** Metadata for an explicitly approximate display-only LOD transition. */
export interface SurfaceBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface LodTransition {
  innerBounds: SurfaceBounds
  outerBounds: SurfaceBounds
  indexStart: number
  indexCount: number
  widthM: number
  samplingM: number
  /** Scientific visibility never samples this interpolated display surface. */
  method: 'coarse triangles plus smoothly decaying fine-boundary residual'
}

interface IndexedSurface {
  positions: Float32Array
  indices: Uint32Array
  lodTransition?: LodTransition
}

interface TriangleBuckets {
  bounds: SurfaceBounds
  cellM: number
  columns: number
  rows: number
  buckets: Map<number, number[]>
}

// Scene meshes are immutable. This weak cache is released when a site mesh is discarded.
const cached = new WeakMap<IndexedSurface, TriangleBuckets>()
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function triangleBuckets(mesh: IndexedSurface, transition: LodTransition): TriangleBuckets {
  const existing = cached.get(mesh)
  if (existing) return existing
  const bounds = transition.outerBounds
  const cellM = Math.max(transition.samplingM, 0.01)
  const columns = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellM))
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellM))
  const buckets = new Map<number, number[]>()
  const { positions: p, indices } = mesh
  const end = transition.indexStart + transition.indexCount
  for (let k = transition.indexStart; k < end; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3
    const minCol = clamp(Math.floor((Math.min(p[a], p[b], p[c]) - bounds.minX) / cellM), 0, columns - 1)
    const maxCol = clamp(Math.floor((Math.max(p[a], p[b], p[c]) - bounds.minX) / cellM), 0, columns - 1)
    const minRow = clamp(Math.floor((Math.min(p[a + 2], p[b + 2], p[c + 2]) - bounds.minZ) / cellM), 0, rows - 1)
    const maxRow = clamp(Math.floor((Math.max(p[a + 2], p[b + 2], p[c + 2]) - bounds.minZ) / cellM), 0, rows - 1)
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      const key = row * columns + col
      const bucket = buckets.get(key)
      if (bucket) bucket.push(k)
      else buckets.set(key, [k])
    }
  }
  const result = { bounds, cellM, columns, rows, buckets }
  cached.set(mesh, result)
  return result
}

/** Height of the rendered transition triangles, for camera clearance only. */
export function transitionHeightAt(mesh: IndexedSurface, x: number, z: number): number | undefined {
  const transition = mesh.lodTransition
  if (!transition) return undefined
  const inner = transition.innerBounds, outer = transition.outerBounds
  if (x < outer.minX || x > outer.maxX || z < outer.minZ || z > outer.maxZ) return undefined
  if (x > inner.minX && x < inner.maxX && z > inner.minZ && z < inner.maxZ) return undefined
  const grid = triangleBuckets(mesh, transition)
  const col = clamp(Math.floor((x - outer.minX) / grid.cellM), 0, grid.columns - 1)
  const row = clamp(Math.floor((z - outer.minZ) / grid.cellM), 0, grid.rows - 1)
  const candidates = grid.buckets.get(row * grid.columns + col) ?? []
  const { positions: p, indices } = mesh
  for (const k of candidates) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3
    const denominator = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c] - p[a])
    if (Math.abs(denominator) < 1e-12) continue
    const wa = ((p[b] - x) * (p[c + 2] - z) - (p[b + 2] - z) * (p[c] - x)) / denominator
    const wb = ((p[c] - x) * (p[a + 2] - z) - (p[c + 2] - z) * (p[a] - x)) / denominator
    const wc = 1 - wa - wb
    if (wa >= -1e-7 && wb >= -1e-7 && wc >= -1e-7) return wa * p[a + 1] + wb * p[b + 1] + wc * p[c + 1]
  }
  return undefined
}
