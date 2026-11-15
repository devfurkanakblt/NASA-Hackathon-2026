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

/** `extended.json` versions this parser understands. */
export const SUPPORTED_EXTENDED_VERSIONS = [1] as const

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Problems with an `extended.json` header for `siteId`, as sentences; empty when it can be used.
 * Checks what the binary parsers rely on: version, site, source, UTC start, step, count, and for
 * cells a full 360° azimuth ring, a positive angle unit and one finite eye height per cell.
 */
export function validateExtendedHeader(siteId: string, header: ExtendedHeader): string[] {
  const issues: string[] = []
  const h = header as Partial<ExtendedHeader> | null | undefined
  if (!h || typeof h !== 'object') return [`${siteId}/extended.json: not an object.`]
  if (!(SUPPORTED_EXTENDED_VERSIONS as readonly unknown[]).includes(h.version)) issues.push(`${siteId}/extended.json: unsupported version ${String(h.version)} (supported: ${SUPPORTED_EXTENDED_VERSIONS.join(', ')}).`)
  if (h.siteId !== siteId) issues.push(`${siteId}/extended.json: siteId is ${JSON.stringify(h.siteId)}, expected ${JSON.stringify(siteId)}.`)
  const y = h.year
  if (!y || typeof y !== 'object') {
    issues.push(`${siteId}/extended.json: no year block.`)
  } else {
    if (typeof y.file !== 'string' || y.file === '') issues.push(`${siteId}/extended.json: year.file missing.`)
    if (typeof y.source !== 'string' || y.source === '') issues.push(`${siteId}/extended.json: year.source missing.`)
    if (typeof y.startUtc !== 'string' || !ISO_UTC.test(y.startUtc) || !Number.isFinite(Date.parse(y.startUtc))) issues.push(`${siteId}/extended.json: year.startUtc must be a UTC time like 2026-11-01T00:00:00Z.`)
    if (!isPosInt(y.stepS)) issues.push(`${siteId}/extended.json: year.stepS must be a positive whole number of seconds.`)
    if (!isPosInt(y.count) || y.count < 2) issues.push(`${siteId}/extended.json: year.count must be at least 2.`)
  }
  const c = h.cells
  if (c !== undefined) {
    if (!c || typeof c !== 'object') {
      issues.push(`${siteId}/extended.json: cells is not an object.`)
    } else {
      if (typeof c.file !== 'string' || c.file === '') issues.push(`${siteId}/extended.json: cells.file missing.`)
      if (!isPosInt(c.count) || !isFiniteNum(c.azStepDeg) || c.azStepDeg <= 0 || Math.abs(c.azStepDeg * c.count - 360) > 1e-9) issues.push(`${siteId}/extended.json: cells must cover 360° of azimuth (azStepDeg × count = 360).`)
      if (!isFiniteNum(c.unitDeg) || c.unitDeg <= 0) issues.push(`${siteId}/extended.json: cells.unitDeg must be a positive number.`)
      if (!isPosInt(c.n)) issues.push(`${siteId}/extended.json: cells.n must be a positive whole number.`)
      if (!Array.isArray(c.eyeM) || c.eyeM.length !== c.n) issues.push(`${siteId}/extended.json: cells.eyeM must hold one eye height per cell (${String(c.n)}).`)
      else if (!c.eyeM.every(isFiniteNum)) issues.push(`${siteId}/extended.json: cells.eyeM has a non-finite value.`)
    }
  }
  return issues
}

function assertHeader(siteId: string, header: ExtendedHeader) {
  const issues = validateExtendedHeader(siteId, header)
  if (issues.length > 0) throw new Error(issues.join(' '))
}

/**
 * Six float32 blocks of `count`: sun az, el, distance, earth az, el, distance. Every value must
 * be finite, azimuths in [0, 360], elevations in [−90, 90] and distances positive; a bad value is
 * an error naming the block and sample, never a silent zero.
 */
export function parseYear(siteId: string, header: ExtendedHeader, buf: ArrayBuffer): EphemerisDoc {
  assertHeader(siteId, header)
  const { count, startUtc, stepS, source } = header.year
  if (buf.byteLength !== 6 * count * 4) throw new Error(`${siteId}/year.bin: expected ${6 * count * 4} bytes, got ${buf.byteLength}`)
  const f = new Float32Array(buf)
  const names = ['sun azDeg', 'sun elDeg', 'sun distanceM', 'earth azDeg', 'earth elDeg', 'earth distanceM']
  const ok = [(v: number) => v >= 0 && v <= 360, (v: number) => v >= -90 && v <= 90, (v: number) => v > 0]
  for (let k = 0; k < 6; k++) {
    const test = ok[k % 3]
    for (let i = 0; i < count; i++) {
      const v = f[k * count + i]
      if (!Number.isFinite(v) || !test(v)) throw new Error(`${siteId}/year.bin: ${names[k]}[${i}] = ${v} is not a valid value.`)
    }
  }
  const block = (k: number) => Array.from(f.subarray(k * count, (k + 1) * count))
  const body = (k: number): BodySeries => ({ azDeg: block(k), elDeg: block(k + 1), distanceM: block(k + 2) })
  return { siteId, source, startUtc, stepS, count, sun: body(0), earth: body(3) }
}

/** Int16 horizon values; each must stay within ±90° once scaled by `unitDeg` (int16 has no NaN). */
export function parseCells(header: ExtendedHeader, buf: ArrayBuffer): CellHorizons {
  const c = header.cells
  if (!c) throw new Error(`${header.siteId}: no map cells`)
  assertHeader(header.siteId, header)
  if (buf.byteLength !== c.n * c.count * 2) throw new Error(`${header.siteId}/cells.bin: expected ${c.n * c.count * 2} bytes, got ${buf.byteLength}`)
  const data = new Int16Array(buf)
  const limit = 90 / c.unitDeg
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > limit) throw new Error(`${header.siteId}/cells.bin: cell ${Math.floor(i / c.count)} azimuth ${(i % c.count) * c.azStepDeg}° has horizon ${data[i] * c.unitDeg}° (outside ±90°).`)
  }
  return { azStepDeg: c.azStepDeg, count: c.count, n: c.n, eyeM: c.eyeM, data, unitDeg: c.unitDeg }
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
