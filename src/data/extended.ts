/**
 * One-year ephemeris (`year.bin`) and per-cell horizons (`cells.bin`), loaded per site on
 * demand after the first render (docs/data-contract.md). The start-up loader (load.ts) does not touch them;
 * if they are missing, the two-month simulation keeps working.
 */
import type { BodySeries, EphemerisDoc, HorizonDoc } from './contract.ts'

/** The only `extendedSchema` this reader understands (docs/data-contract.md, extended.json). */
export const SUPPORTED_EXTENDED_SCHEMA = 2

const YEAR_FIELDS = ['sun.azDeg', 'sun.elDeg', 'sun.distanceM', 'earth.azDeg', 'earth.elDeg', 'earth.distanceM'] as const

export interface ExtendedHeader {
  version: number
  extendedSchema: number
  siteId: string
  year: {
    file: string
    sha256: string
    startUtc: string
    /** Inclusive: the last sample is `startUtc + (count - 1) * stepS`. */
    endUtc: string
    stepS: number
    count: number
    source: string
    observer: { latDeg: number; lonDeg: number; eyeM: number }
    fields: string[]
  }
  cells?: {
    file: string
    sha256: string
    azStartDeg: number
    azStepDeg: number
    count: number
    coverageDeg: number
    unitDeg: number
    horizonResolutionDeg: number
    n: number
    eyeM: number[]
    grid: { nx: number; ny: number; spacingM: number; halfSizeM: number }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isSha = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

/**
 * Checks an `extended.json` against schema 2. Returns one English sentence per problem
 * (each names `<siteId>/extended.json`); an empty array means the header is valid.
 * `sha256` is only checked for shape here; `npm test` verifies it against the real files.
 */
export function validateExtendedHeader(h: unknown, siteId: string): string[] {
  const where = `${siteId}/extended.json`
  const out: string[] = []
  const bad = (msg: string) => out.push(`${where}: ${msg}`)
  if (!isObj(h)) return [`${where}: header must be a JSON object`]
  if (h.extendedSchema !== SUPPORTED_EXTENDED_SCHEMA) bad(`extendedSchema must be ${SUPPORTED_EXTENDED_SCHEMA}, got ${JSON.stringify(h.extendedSchema)}`)
  if (h.siteId !== siteId) bad(`siteId must be "${siteId}", got ${JSON.stringify(h.siteId)}`)
  const y = h.year
  if (!isObj(y)) bad('year section is missing')
  else {
    if (typeof y.file !== 'string' || !y.file) bad('year.file must be a non-empty string')
    if (!isSha(y.sha256)) bad('year.sha256 must be 64 lowercase hex characters')
    if (y.stepS !== 600) bad(`year.stepS must be 600, got ${JSON.stringify(y.stepS)}`)
    if (!isPosInt(y.count)) bad(`year.count must be a positive integer, got ${JSON.stringify(y.count)}`)
    if (typeof y.source !== 'string' || !y.source) bad('year.source must be a non-empty string')
    const start = typeof y.startUtc === 'string' ? Date.parse(y.startUtc) : NaN
    const end = typeof y.endUtc === 'string' ? Date.parse(y.endUtc) : NaN
    if (!Number.isFinite(start)) bad(`year.startUtc is not a parsable UTC time: ${JSON.stringify(y.startUtc)}`)
    if (!Number.isFinite(end)) bad(`year.endUtc is not a parsable UTC time: ${JSON.stringify(y.endUtc)}`)
    if (Number.isFinite(start) && Number.isFinite(end) && isPosInt(y.count) && isNum(y.stepS) && end !== start + (y.count - 1) * y.stepS * 1000) {
      bad(`year.endUtc must equal startUtc + (count - 1) * stepS, got ${String(y.endUtc)}`)
    }
    const o = y.observer
    if (!isObj(o) || !isNum(o.latDeg) || !isNum(o.lonDeg) || !isNum(o.eyeM)) bad('year.observer must have finite latDeg, lonDeg and eyeM')
    if (!Array.isArray(y.fields) || y.fields.length !== YEAR_FIELDS.length || YEAR_FIELDS.some((f, i) => (y.fields as unknown[])[i] !== f)) {
      bad(`year.fields must be exactly [${YEAR_FIELDS.join(', ')}] in that order`)
    }
  }
  const c = h.cells
  if (c !== undefined) {
    if (!isObj(c)) bad('cells section must be an object')
    else {
      if (typeof c.file !== 'string' || !c.file) bad('cells.file must be a non-empty string')
      if (!isSha(c.sha256)) bad('cells.sha256 must be 64 lowercase hex characters')
      if (c.azStartDeg !== 0) bad(`cells.azStartDeg must be 0, got ${JSON.stringify(c.azStartDeg)}`)
      if (!isNum(c.azStepDeg) || c.azStepDeg <= 0 || !isPosInt(c.count) || Math.abs(c.azStepDeg * c.count - 360) > 1e-9) {
        bad(`cells.azStepDeg * count must equal 360, got ${JSON.stringify(c.azStepDeg)} * ${JSON.stringify(c.count)}`)
      }
      if (c.coverageDeg !== 360) bad(`cells.coverageDeg must be 360, got ${JSON.stringify(c.coverageDeg)}`)
      if (!isNum(c.unitDeg) || c.unitDeg <= 0) bad(`cells.unitDeg must be a positive number, got ${JSON.stringify(c.unitDeg)}`)
      if (!isNum(c.horizonResolutionDeg) || c.horizonResolutionDeg <= 0) bad('cells.horizonResolutionDeg must be a positive number')
      if (!isPosInt(c.n)) bad(`cells.n must be a positive integer, got ${JSON.stringify(c.n)}`)
      if (!Array.isArray(c.eyeM) || (isPosInt(c.n) && c.eyeM.length !== c.n)) bad(`cells.eyeM must be an array of length n (${JSON.stringify(c.n)})`)
      else if (!c.eyeM.every(isNum)) bad('cells.eyeM contains a non-finite value')
      const g = c.grid
      if (!isObj(g) || !isPosInt(g.nx) || !isPosInt(g.ny) || !isNum(g.spacingM) || !isNum(g.halfSizeM)) {
        bad('cells.grid must have positive integer nx, ny and finite spacingM, halfSizeM')
      } else if (isPosInt(c.n) && g.nx * g.ny !== c.n) bad(`cells.grid nx * ny (${g.nx * g.ny}) must equal cells.n (${c.n})`)
    }
  }
  return out
}

function assertValidHeader(siteId: string, header: unknown): asserts header is ExtendedHeader {
  const issues = validateExtendedHeader(header, siteId)
  if (issues.length) throw new Error(issues.join('; '))
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
  assertValidHeader(siteId, header)
  const { count, startUtc, stepS, source } = header.year
  if (buf.byteLength !== 6 * count * 4) throw new Error(`${siteId}/year.bin: expected ${6 * count * 4} bytes, got ${buf.byteLength}`)
  const f = new Float32Array(buf)
  for (let i = 0; i < f.length; i++) {
    if (!Number.isFinite(f[i])) throw new Error(`${siteId}/year.bin: value ${f[i]} at index ${i} is not finite`)
  }
  const block = (k: number) => Array.from(f.subarray(k * count, (k + 1) * count))
  const body = (k: number): BodySeries => ({ azDeg: block(k), elDeg: block(k + 1), distanceM: block(k + 2) })
  return { siteId, source, startUtc, stepS, count, sun: body(0), earth: body(3) }
}

export function parseCells(header: ExtendedHeader, buf: ArrayBuffer): CellHorizons {
  const siteId = header.siteId
  assertValidHeader(siteId, header)
  const c = header.cells
  if (!c) throw new Error(`${siteId}: no map cells`)
  if (buf.byteLength !== c.n * c.count * 2) throw new Error(`${siteId}/cells.bin: expected ${c.n * c.count * 2} bytes, got ${buf.byteLength}`)
  const data = new Int16Array(buf)
  const at = data.indexOf(-32768)
  if (at >= 0) throw new Error(`${siteId}/cells.bin: sentinel value -32768 at index ${at} (no horizon was computed)`)
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

/** Fetches and validates `extended.json`; `sha256` is not recomputed in the browser (tests check it). */
function loadHeader(siteId: string, baseUrl: string): Promise<ExtendedHeader> {
  return cached(headers, `${baseUrl}/${siteId}`, async () => {
    const header: unknown = await (await getOk(`${baseUrl}/${siteId}/extended.json`)).json()
    assertValidHeader(siteId, header)
    return header
  })
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
