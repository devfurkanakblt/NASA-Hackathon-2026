/**
 * Global DEM tiles for free coordinates (`public/data/global-dem/`, written by
 * `python -m preprocess.global_tiles`): LOLA LDEM_64, by default as its 4 × 4 block mean
 * (16 px/deg, ~1.9 km/px). Tiles are fetched on demand, checked against the manifest's size and
 * SHA-256, and cached. Heights are metres above the 1737.4 km sphere.
 */

export interface GlobalDemManifest {
  version: 1
  kind: 'global-dem-tiles'
  source: string
  sourceUrl: string
  method: string
  ppd: number
  pixelM: number
  scaleM: number
  radiusM: number
  rows: number
  cols: number
  tileDeg: number
  tilePx: number
  layout: string
  tiles: Record<string, { sha256: string; bytes: number }>
}

export function validateGlobalDemManifest(m: unknown): string[] {
  const issues: string[] = []
  const x = m as Partial<GlobalDemManifest> | null
  if (!x || typeof x !== 'object') return ['global-dem/manifest.json: not an object.']
  if (x.version !== 1 || x.kind !== 'global-dem-tiles') issues.push('global-dem/manifest.json: unsupported version or kind.')
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
  if (!pos(x.ppd) || !pos(x.scaleM) || !pos(x.radiusM) || !pos(x.tilePx) || !pos(x.tileDeg)) issues.push('global-dem/manifest.json: ppd, scaleM, radiusM, tileDeg and tilePx must be positive.')
  if (pos(x.ppd) && (x.rows !== 180 * x.ppd! || x.cols !== 360 * x.ppd!)) issues.push('global-dem/manifest.json: rows/cols do not cover the whole Moon.')
  if (pos(x.ppd) && pos(x.tileDeg) && x.tilePx !== x.tileDeg! * x.ppd!) issues.push('global-dem/manifest.json: tilePx must equal tileDeg × ppd.')
  if (!x.tiles || typeof x.tiles !== 'object') issues.push('global-dem/manifest.json: no tile list.')
  else if (pos(x.tilePx) && x.rows && x.cols && Object.keys(x.tiles).length !== (x.rows / x.tilePx!) * (x.cols / x.tilePx!)) issues.push('global-dem/manifest.json: tile list is incomplete.')
  return issues
}

/** Tile name for grid row/column (pixel indices). */
export const tileName = (m: Pick<GlobalDemManifest, 'tilePx'>, row: number, col: number) => `t_${Math.floor(row / m.tilePx)}_${Math.floor(col / m.tilePx)}.bin`

/**
 * Heights from a set of loaded tiles. Bilinear between pixel centres; longitude is periodic, and
 * beyond the first / last row centre the nearest row is used (no invented polar terrain).
 * Asking for a pixel whose tile is not loaded throws, so a missing tile can never read as zero.
 */
export class GlobalDem {
  readonly manifest: GlobalDemManifest
  private readonly tiles: Map<string, Int16Array>
  constructor(manifest: GlobalDemManifest, tiles: Map<string, Int16Array>) {
    this.manifest = manifest
    this.tiles = tiles
  }

  private px(row: number, col: number): number {
    const m = this.manifest
    const r = Math.min(m.rows - 1, Math.max(0, row))
    const c = ((col % m.cols) + m.cols) % m.cols
    const t = this.tiles.get(tileName(m, r, c))
    if (!t) throw new RangeError(`Global DEM tile ${tileName(m, r, c)} is not loaded.`)
    return t[(r % m.tilePx) * m.tilePx + (c % m.tilePx)] * m.scaleM
  }

  /** Terrain height (m above the reference sphere) at a latitude / longitude in degrees. */
  heightAt(latDeg: number, lonDeg: number): number {
    const m = this.manifest
    const y = (90 - latDeg) * m.ppd - 0.5
    const x = ((((lonDeg % 360) + 360) % 360) * m.ppd) - 0.5
    const r0 = Math.floor(y)
    const c0 = Math.floor(x)
    const fy = y - r0
    const fx = x - c0
    const a = this.px(r0, c0)
    const b = this.px(r0, c0 + 1)
    const c = this.px(r0 + 1, c0)
    const d = this.px(r0 + 1, c0 + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }
}

/** Tiles needed for every point within `rangeM` of (lat, lon), plus one pixel of margin. */
export function tilesAround(m: GlobalDemManifest, latDeg: number, lonDeg: number, rangeM: number): string[] {
  const dLat = ((rangeM / m.radiusM) * 180) / Math.PI + 2 / m.ppd
  const latMin = Math.max(-90, latDeg - dLat)
  const latMax = Math.min(90, latDeg + dLat)
  const nearPole = latMin <= -89.9 || latMax >= 89.9
  const cosMin = Math.min(Math.cos((latMin * Math.PI) / 180), Math.cos((latMax * Math.PI) / 180))
  const dLon = nearPole || cosMin < 1e-6 ? 180 : Math.min(180, dLat / cosMin)
  const r0 = Math.max(0, Math.floor((90 - latMax) * m.ppd) - 1)
  const r1 = Math.min(m.rows - 1, Math.ceil((90 - latMin) * m.ppd) + 1)
  const tileRows = [Math.floor(r0 / m.tilePx), Math.floor(r1 / m.tilePx)]
  const tileCols = m.cols / m.tilePx
  // column range, possibly below 0 or past the last column (wraps)
  const c0 = dLon >= 180 ? 0 : Math.floor((lonDeg - dLon) * m.ppd) - 1
  const c1 = dLon >= 180 ? m.cols - 1 : Math.ceil((lonDeg + dLon) * m.ppd) + 1
  const names = new Set<string>()
  for (let tr = tileRows[0]; tr <= tileRows[1]; tr++) {
    for (let tc = Math.floor(c0 / m.tilePx); tc <= Math.floor(c1 / m.tilePx); tc++) names.add(`t_${tr}_${((tc % tileCols) + tileCols) % tileCols}.bin`)
  }
  return [...names].sort()
}

// ---------------------------------------------------------------------------------------------
// Loading (same-origin files only)

const defaultBase = () => `${import.meta.env.BASE_URL}data/global-dem`

async function getBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.arrayBuffer()
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, '0')).join('')
}

let manifestPromise: { base: string; p: Promise<GlobalDemManifest> } | null = null
const tileCache = new Map<string, Promise<Int16Array>>()

export function loadGlobalDemManifest(base = defaultBase()): Promise<GlobalDemManifest> {
  if (manifestPromise?.base !== base) {
    const p = getBytes(`${base}/manifest.json`).then((b) => {
      const m = JSON.parse(new TextDecoder().decode(b)) as GlobalDemManifest
      const issues = validateGlobalDemManifest(m)
      if (issues.length) throw new Error(issues.join(' '))
      return m
    })
    manifestPromise = { base, p }
    p.catch(() => {
      if (manifestPromise?.p === p) manifestPromise = null
    })
  }
  return manifestPromise.p
}

function loadTile(m: GlobalDemManifest, name: string, base: string, signal?: AbortSignal): Promise<Int16Array> {
  const key = `${base}/${name}`
  let p = tileCache.get(key)
  if (!p) {
    const meta = m.tiles[name]
    p = (async () => {
      if (!meta) throw new Error(`global-dem/${name}: not in the manifest.`)
      const buf = await getBytes(key, signal)
      if (buf.byteLength !== meta.bytes || buf.byteLength !== m.tilePx * m.tilePx * 2) throw new Error(`global-dem/${name}: expected ${meta.bytes} bytes, got ${buf.byteLength}.`)
      if ((await sha256Hex(buf)) !== meta.sha256) throw new Error(`global-dem/${name}: sha256 mismatch.`)
      return new Int16Array(buf)
    })()
    tileCache.set(key, p)
    p.catch(() => tileCache.delete(key))
  }
  return p
}

/** A `GlobalDem` holding every tile within `rangeM` of the point. */
export async function loadGlobalDemAround(latDeg: number, lonDeg: number, rangeM: number, opts: { base?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<GlobalDem> {
  const base = opts.base ?? defaultBase()
  const m = await loadGlobalDemManifest(base)
  const names = tilesAround(m, latDeg, lonDeg, rangeM)
  let done = 0
  opts.onProgress?.(0, names.length)
  const tiles = new Map<string, Int16Array>()
  await Promise.all(
    names.map(async (n) => {
      tiles.set(n, await loadTile(m, n, base, opts.signal))
      opts.onProgress?.(++done, names.length)
    }),
  )
  return new GlobalDem(m, tiles)
}
