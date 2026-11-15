import { appBase } from './appBase.ts'
/**
 * South-polar 80 m DEM for free coordinates (`public/data/polar-dem/`, written by
 * `python -m preprocess.polar_tiles` from LOLA LDEM_80S_80MPP_ADJ, the regional DEM the catalogue
 * uses). Near field: the 80 m grid in 256 × 256 tiles; far field: its 640 m block mean. Files are
 * gzip, rows delta-encoded, int16 heights in 0.5 m; each file is checked against the manifest's
 * size and SHA-256. Heights are metres above the 1737.4 km sphere; outside the grid, or on a
 * no-data pixel, a sample is NaN (never zero terrain).
 */

export interface PolarDemManifest {
  version: 1
  kind: 'polar-dem-tiles'
  source: string
  sourceUrl: string
  projection: { proj: 'stere'; lat0Deg: -90; latTsDeg: -90; lon0Deg: 0; radiusM: number }
  scaleM: number
  nodata: number
  encoding: string
  near: { left: number; top: number; resM: number; rows: number; cols: number; tilePx: number }
  far: { left: number; top: number; resM: number; rows: number; cols: number; file: string; method: string }
  pixelCentre: string
  files: Record<string, { sha256: string; bytes: number }>
}

export function validatePolarDemManifest(m: unknown): string[] {
  const x = m as Partial<PolarDemManifest> | null
  if (!x || typeof x !== 'object') return ['polar-dem/manifest.json: not an object.']
  const issues: string[] = []
  if (x.version !== 1 || x.kind !== 'polar-dem-tiles') issues.push('polar-dem/manifest.json: unsupported version or kind.')
  const p = x.projection
  if (!p || p.proj !== 'stere' || p.lat0Deg !== -90 || p.latTsDeg !== -90 || p.lon0Deg !== 0 || !(p.radiusM > 0)) issues.push('polar-dem/manifest.json: only the south polar stereographic sphere is supported.')
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
  if (!x.near || !pos(x.near.resM) || !pos(x.near.tilePx) || !pos(x.near.rows) || !pos(x.near.cols)) issues.push('polar-dem/manifest.json: near grid incomplete.')
  if (!x.far || !pos(x.far.resM) || !pos(x.far.rows) || !pos(x.far.cols) || !x.far.file) issues.push('polar-dem/manifest.json: far grid incomplete.')
  if (!pos(x.scaleM) || typeof x.nodata !== 'number') issues.push('polar-dem/manifest.json: scale or no-data value missing.')
  if (!x.files || !x.far || !x.files[x.far.file]) issues.push('polar-dem/manifest.json: file list incomplete.')
  return issues
}

const RAD = Math.PI / 180

/** Polar stereographic x, y (m) of a latitude / longitude: ρ = 2R·tan(45° + φ/2), x = ρ sin λ, y = ρ cos λ. */
export function polarXY(m: Pick<PolarDemManifest, 'projection'>, latDeg: number, lonDeg: number): [number, number] {
  const rho = 2 * m.projection.radiusM * Math.tan(Math.PI / 4 + (latDeg * RAD) / 2)
  return [rho * Math.sin(lonDeg * RAD), rho * Math.cos(lonDeg * RAD)]
}

/** Undo the per-row delta encoding of an int16 grid of `width` columns (in place). */
export function undelta(data: Int16Array, width: number): Int16Array {
  for (let r = 0; r < data.length / width; r++) {
    let acc = 0
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      acc = (acc + data[i]) | 0
      data[i] = acc
    }
  }
  return data
}

interface Grid {
  left: number
  top: number
  resM: number
  rows: number
  cols: number
}

function bilinear(g: Grid, get: (r: number, c: number) => number, x: number, y: number, nodata: number, scale: number): number {
  const fc = (x - g.left) / g.resM - 0.5
  const fr = (g.top - y) / g.resM - 0.5
  const c0 = Math.floor(fc)
  const r0 = Math.floor(fr)
  if (c0 < 0 || r0 < 0 || c0 >= g.cols - 1 || r0 >= g.rows - 1) return Number.NaN
  const a = get(r0, c0)
  const b = get(r0, c0 + 1)
  const c = get(r0 + 1, c0)
  const d = get(r0 + 1, c0 + 1)
  if (a === nodata || b === nodata || c === nodata || d === nodata || Number.isNaN(a + b + c + d)) return Number.NaN
  const tx = fc - c0
  const ty = fr - r0
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * scale
}

export class PolarDem {
  readonly manifest: PolarDemManifest
  private readonly near: Map<string, Int16Array>
  private readonly far: Int16Array

  constructor(manifest: PolarDemManifest, near: Map<string, Int16Array>, far: Int16Array) {
    this.manifest = manifest
    this.near = near
    this.far = far
  }

  /** 80 m height at x, y; NaN outside the grid, on no data, or where the tile is not loaded. */
  nearAt(x: number, y: number): number {
    const m = this.manifest
    const t = m.near.tilePx
    const get = (r: number, c: number) => {
      const tile = this.near.get(`n_${Math.floor(r / t)}_${Math.floor(c / t)}.bin.gz`)
      return tile ? tile[(r % t) * t + (c % t)] : Number.NaN
    }
    return bilinear(m.near, get, x, y, m.nodata, m.scaleM)
  }

  /** 640 m height at x, y; NaN outside the grid or on no data. */
  farAt(x: number, y: number): number {
    const m = this.manifest
    return bilinear(m.far, (r, c) => this.far[r * m.far.cols + c], x, y, m.nodata, m.scaleM)
  }

  /** Is (lat, lon) far enough inside the grid that a ray of `rangeM` can start on 80 m data? */
  covers(latDeg: number, lonDeg: number): boolean {
    const [x, y] = polarXY(this.manifest, latDeg, lonDeg)
    return Number.isFinite(this.nearAt(x, y))
  }
}

/** Tiles of the 80 m grid within `rangeM` of (lat, lon), plus one pixel. */
export function nearTilesAround(m: PolarDemManifest, latDeg: number, lonDeg: number, rangeM: number): string[] {
  const [x, y] = polarXY(m, latDeg, lonDeg)
  const g = m.near
  const pad = rangeM * 1.02 + 2 * g.resM // stereographic scale grows slightly away from the pole
  const c0 = Math.max(0, Math.floor((x - pad - g.left) / g.resM))
  const c1 = Math.min(g.cols - 1, Math.floor((x + pad - g.left) / g.resM))
  const r0 = Math.max(0, Math.floor((g.top - (y + pad)) / g.resM))
  const r1 = Math.min(g.rows - 1, Math.floor((g.top - (y - pad)) / g.resM))
  const names: string[] = []
  for (let tr = Math.floor(r0 / g.tilePx); tr <= Math.floor(r1 / g.tilePx); tr++) {
    for (let tc = Math.floor(c0 / g.tilePx); tc <= Math.floor(c1 / g.tilePx); tc++) {
      const n = `n_${tr}_${tc}.bin.gz`
      if (m.files[n]) names.push(n)
    }
  }
  return names
}

// ---------------------------------------------------------------------------------------------
// Loading (same-origin files only)

const defaultBase = () => `${appBase()}data/polar-dem`

async function getBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.arrayBuffer()
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, '0')).join('')
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

/** Checks size and hash, decompresses and undoes the delta encoding. */
export async function decodePolarFile(m: PolarDemManifest, name: string, buf: ArrayBuffer, width: number, height: number): Promise<Int16Array> {
  const meta = m.files[name]
  if (!meta) throw new Error(`polar-dem/${name}: not in the manifest.`)
  if (buf.byteLength !== meta.bytes) throw new Error(`polar-dem/${name}: expected ${meta.bytes} bytes, got ${buf.byteLength}.`)
  if ((await sha256Hex(buf)) !== meta.sha256) throw new Error(`polar-dem/${name}: sha256 mismatch.`)
  const raw = await gunzip(buf)
  if (raw.byteLength !== width * height * 2) throw new Error(`polar-dem/${name}: decoded size ${raw.byteLength}, expected ${width * height * 2}.`)
  return undelta(new Int16Array(raw), width)
}

let manifestPromise: { base: string; p: Promise<PolarDemManifest> } | null = null
const fileCache = new Map<string, Promise<Int16Array>>()

export function loadPolarDemManifest(base = defaultBase()): Promise<PolarDemManifest> {
  if (manifestPromise?.base !== base) {
    const p = getBytes(`${base}/manifest.json`).then((b) => {
      const m = JSON.parse(new TextDecoder().decode(b)) as PolarDemManifest
      const issues = validatePolarDemManifest(m)
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

function loadFile(m: PolarDemManifest, base: string, name: string, width: number, height: number, signal?: AbortSignal): Promise<Int16Array> {
  const key = `${base}/${name}`
  let p = fileCache.get(key)
  if (!p) {
    p = getBytes(key, signal).then((buf) => decodePolarFile(m, name, buf, width, height))
    fileCache.set(key, p)
    p.catch(() => fileCache.delete(key))
  }
  return p
}

/** The polar DEM with the 80 m tiles within `nearRangeM` of the point and the whole 640 m far grid. */
export async function loadPolarDemAround(latDeg: number, lonDeg: number, nearRangeM: number, opts: { base?: string; signal?: AbortSignal } = {}): Promise<PolarDem> {
  const base = opts.base ?? defaultBase()
  const m = await loadPolarDemManifest(base)
  const names = nearTilesAround(m, latDeg, lonDeg, nearRangeM)
  const t = m.near.tilePx
  const [far, ...tiles] = await Promise.all([
    loadFile(m, base, m.far.file, m.far.cols, m.far.rows, opts.signal),
    ...names.map((n) => loadFile(m, base, n, t, t, opts.signal)),
  ])
  return new PolarDem(m, new Map(names.map((n, i) => [n, tiles[i]])), far)
}
