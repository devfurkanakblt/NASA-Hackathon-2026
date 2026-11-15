/**
 * One-year ephemeris (`year.bin`) and per-cell horizons (`cells.bin`), loaded per site on
 * demand after the first render (docs/data-contract.md). The start-up loader (load.ts) does not touch them;
 * if they are missing, the two-month simulation keeps working.
 */
import type { BodySeries, EphemerisDoc, HorizonDoc } from './contract.ts'

export interface ExtendedHeader {
  version: number
  siteId: string
  year: { file: string; startUtc: string; stepS: number; count: number; source: string }
  cells?: { file: string; azStepDeg: number; count: number; unitDeg: number; n: number; eyeM: number[] }
}

export interface CellHorizons {
  azStepDeg: number
  /** Azimuth samples per cell. */
  count: number
  /** Number of cells (map.json order). */
  n: number
  /** Eye height of each cell above the 1737.4 km sphere. */
  eyeM: number[]
  /** `n × count` horizon values in `unitDeg`. */
  data: Int16Array
  unitDeg: number
}

/** Six float32 blocks of `count`: sun az, el, distance, earth az, el, distance. */
export function parseYear(siteId: string, header: ExtendedHeader, buf: ArrayBuffer): EphemerisDoc {
  const { count, startUtc, stepS, source } = header.year
  if (buf.byteLength !== 6 * count * 4) throw new Error(`${siteId}/year.bin: expected ${6 * count * 4} bytes, got ${buf.byteLength}`)
  const f = new Float32Array(buf)
  const block = (k: number) => Array.from(f.subarray(k * count, (k + 1) * count))
  const body = (k: number): BodySeries => ({ azDeg: block(k), elDeg: block(k + 1), distanceM: block(k + 2) })
  return { siteId, source, startUtc, stepS, count, sun: body(0), earth: body(3) }
}

export function parseCells(header: ExtendedHeader, buf: ArrayBuffer): CellHorizons {
  const c = header.cells
  if (!c) throw new Error(`${header.siteId}: no map cells`)
  if (buf.byteLength !== c.n * c.count * 2) throw new Error(`${header.siteId}/cells.bin: expected ${c.n * c.count * 2} bytes, got ${buf.byteLength}`)
  return { azStepDeg: c.azStepDeg, count: c.count, n: c.n, eyeM: c.eyeM, data: new Int16Array(buf), unitDeg: c.unitDeg }
}

/** The 1° horizon of one cell. There is no `distanceM` for cells. */
export function cellHorizon(cells: CellHorizons, index: number): HorizonDoc {
  if (!Number.isInteger(index) || index < 0 || index >= cells.n) throw new RangeError(`Cell index ${index} outside 0..${cells.n - 1}`)
  const row = cells.data.subarray(index * cells.count, (index + 1) * cells.count)
  return { azStepDeg: cells.azStepDeg, count: cells.count, elevDeg: Array.from(row, (v) => v * cells.unitDeg) }
}

const defaultBase = () => `${import.meta.env.BASE_URL}data`

async function getOk(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

/** One cached promise per key; a failed promise is dropped so a later call can retry. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = make()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

const headers = new Map<string, Promise<ExtendedHeader>>()
const years = new Map<string, Promise<EphemerisDoc>>()
const cellsCache = new Map<string, Promise<CellHorizons>>()

function loadHeader(siteId: string, baseUrl: string): Promise<ExtendedHeader> {
  return cached(headers, `${baseUrl}/${siteId}`, async () => (await (await getOk(`${baseUrl}/${siteId}/extended.json`)).json()) as ExtendedHeader)
}

/** One-year ephemeris of a site (cached per site). */
export function loadYear(siteId: string, baseUrl = defaultBase()): Promise<EphemerisDoc> {
  return cached(years, `${baseUrl}/${siteId}`, async () => {
    const header = await loadHeader(siteId, baseUrl)
    const buf = await (await getOk(`${baseUrl}/${siteId}/${header.year.file}`)).arrayBuffer()
    return parseYear(siteId, header, buf)
  })
}

/** 1° horizons of every regional map cell of a site (cached per site). */
export function loadCells(siteId: string, baseUrl = defaultBase()): Promise<CellHorizons> {
  return cached(cellsCache, `${baseUrl}/${siteId}`, async () => {
    const header = await loadHeader(siteId, baseUrl)
    if (!header.cells) throw new Error(`${siteId}: no map cells`)
    const buf = await (await getOk(`${baseUrl}/${siteId}/${header.cells.file}`)).arrayBuffer()
    return parseCells(header, buf)
  })
}

/** Home-page descent terrain (preprocess/hero_terrain.py): display-only LOLA heights near Shackleton. */
export interface HeroTerrainCrop { bounds: number[]; 'mesh-desktop': number; 'mesh-mobile': number }
export interface HeroTerrainData {
  meta: { crops: { near: HeroTerrainCrop; far: HeroTerrainCrop } }
  near: ArrayBuffer
  far: ArrayBuffer
}

const heroTerrain = new Map<string, Promise<HeroTerrainData>>()

/** Heights for the descent, loaded on demand after the intro is showing (cached per variant). */
export function loadHeroTerrain(mobile: boolean, baseUrl = `${import.meta.env.BASE_URL}assets/hero/terrain`): Promise<HeroTerrainData> {
  const suffix = mobile ? '-mobile' : ''
  return cached(heroTerrain, `${baseUrl}${suffix}`, async () => {
    const [meta, near, far] = await Promise.all([
      getOk(`${baseUrl}/terrain.json`).then((r) => r.json() as Promise<HeroTerrainData['meta']>),
      getOk(`${baseUrl}/near${suffix}-height.bin`).then((r) => r.arrayBuffer()),
      getOk(`${baseUrl}/far${suffix}-height.bin`).then((r) => r.arrayBuffer()),
    ])
    return { meta, near, far }
  })
}
