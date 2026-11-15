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
const utcTime = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)) return NaN
  const ms = Date.parse(v)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19) ? ms : NaN
}

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
  if (h.version !== 1) bad('version must be 1')
  if (h.extendedSchema !== SUPPORTED_EXTENDED_SCHEMA) bad(`extendedSchema must be ${SUPPORTED_EXTENDED_SCHEMA}, got ${JSON.stringify(h.extendedSchema)}`)
  if (h.siteId !== siteId) bad(`siteId must be "${siteId}", got ${JSON.stringify(h.siteId)}`)
  const y = h.year
  if (!isObj(y)) bad('year section is missing')
  else {
    if (y.file !== 'year.bin') bad('year.file must be year.bin')
    if (!isSha(y.sha256)) bad('year.sha256 must be 64 lowercase hex characters')
    if (y.stepS !== 600) bad(`year.stepS must be 600, got ${JSON.stringify(y.stepS)}`)
    if (!isPosInt(y.count)) bad(`year.count must be a positive integer, got ${JSON.stringify(y.count)}`)
    if (!['jpl-horizons', 'skyfield-de421'].includes(y.source as string)) bad('year.source must be jpl-horizons or skyfield-de421')
    const start = utcTime(y.startUtc)
    const end = utcTime(y.endUtc)
    if (!Number.isFinite(start)) bad(`year.startUtc is not a parsable UTC time: ${JSON.stringify(y.startUtc)}`)
    if (!Number.isFinite(end)) bad(`year.endUtc is not a parsable UTC time: ${JSON.stringify(y.endUtc)}`)
    if (Number.isFinite(start) && Number.isFinite(end) && isPosInt(y.count) && isNum(y.stepS) && end !== start + (y.count - 1) * y.stepS * 1000) {
      bad(`year.endUtc must equal startUtc + (count - 1) * stepS, got ${String(y.endUtc)}`)
    }
    const o = y.observer
    if (!isObj(o) || !isNum(o.latDeg) || !isNum(o.lonDeg) || !isNum(o.eyeM)) bad('year.observer must have finite latDeg, lonDeg and eyeM')
    else if (Math.abs(o.latDeg) > 90 || Math.abs(o.lonDeg) > 180) bad('year.observer coordinate is outside latitude/longitude bounds')
    if (!Array.isArray(y.fields) || y.fields.length !== YEAR_FIELDS.length || YEAR_FIELDS.some((f, i) => (y.fields as unknown[])[i] !== f)) {
      bad(`year.fields must be exactly [${YEAR_FIELDS.join(', ')}] in that order`)
    }
  }
  const c = h.cells
  if (c !== undefined) {
    if (!isObj(c)) bad('cells section must be an object')
    else {
      if (c.file !== 'cells.bin') bad('cells.file must be cells.bin')
      if (!isSha(c.sha256)) bad('cells.sha256 must be 64 lowercase hex characters')
      if (c.azStartDeg !== 0) bad(`cells.azStartDeg must be 0, got ${JSON.stringify(c.azStartDeg)}`)
      if (!isNum(c.azStepDeg) || c.azStepDeg <= 0 || !isPosInt(c.count) || Math.abs(c.azStepDeg * c.count - 360) > 1e-9) {
        bad(`cells.azStepDeg * count must equal 360, got ${JSON.stringify(c.azStepDeg)} * ${JSON.stringify(c.count)}`)
      }
      if (c.coverageDeg !== 360) bad(`cells.coverageDeg must be 360, got ${JSON.stringify(c.coverageDeg)}`)
      if (c.unitDeg !== .01) bad('cells.unitDeg must be 0.01')
      if (c.horizonResolutionDeg !== c.azStepDeg) bad('cells.horizonResolutionDeg must equal azStepDeg')
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

/** One map cell recomputed with the 0.1° catalogue horizon (`python -m preprocess.refine_cells`). */
export interface RefinedCell {
  latDeg: number
  lonDeg: number
  /** Same observer as `cells.eyeM[i]`: surface + 2 m above the 1737.4 km sphere. */
  eyeM: number
  azStepDeg: number
  count: number
  elevDeg: number[]
  distanceM: number[]
  /** Near-field and far-terrain coverage warnings of this horizon, verbatim from the pipeline. */
  warnings: string[]
}

/** `refined.json`: a few finalist map cells, keyed `r<row>c<col>`, bound to one `cells.bin` by its sha256. */
export interface RefinedDoc {
  version: 1
  siteId: string
  cellsSha256: string
  cells: Record<string, RefinedCell>
}

/**
 * Checks a `refined.json` against the site's `extended.json`. Returns one English sentence per problem;
 * a `cellsSha256` that differs from `cells.sha256` makes the whole file stale.
 */
export function validateRefined(doc: unknown, siteId: string, header: ExtendedHeader): string[] {
  const where = `${siteId}/refined.json`
  if (!isObj(doc)) return [`${where}: must be a JSON object`]
  const out: string[] = []
  const bad = (msg: string) => out.push(`${where}: ${msg}`)
  if (doc.version !== 1) bad(`version must be 1, got ${JSON.stringify(doc.version)}`)
  if (doc.siteId !== siteId) bad(`siteId must be "${siteId}", got ${JSON.stringify(doc.siteId)}`)
  if (!header.cells) bad('the site has no map cells in extended.json')
  else if (doc.cellsSha256 !== header.cells.sha256) bad(`stale: cellsSha256 ${JSON.stringify(doc.cellsSha256)} does not match cells.sha256 ${header.cells.sha256} in extended.json`)
  if (!isObj(doc.cells)) return [...out, `${where}: cells must be an object`]
  for (const [id, c] of Object.entries(doc.cells)) {
    if (!/^r\d+c\d+$/.test(id)) bad(`cell id ${JSON.stringify(id)} must look like r<row>c<col>`)
    if (!isObj(c)) { bad(`${id} must be an object`); continue }
    if (!isNum(c.latDeg) || !isNum(c.lonDeg) || !isNum(c.eyeM)) bad(`${id} must have finite latDeg, lonDeg and eyeM`)
    if (!isNum(c.azStepDeg) || !isPosInt(c.count) || Math.abs(c.azStepDeg * c.count - 360) > 1e-9) bad(`${id}: azStepDeg * count must equal 360`)
    for (const k of ['elevDeg', 'distanceM'] as const) {
      const a = c[k]
      if (!Array.isArray(a) || a.length !== c.count || !a.every(isNum)) bad(`${id}.${k} must be ${JSON.stringify(c.count)} finite numbers`)
    }
    if (!Array.isArray(c.warnings) || !c.warnings.every((w) => typeof w === 'string')) bad(`${id}.warnings must be an array of strings`)
  }
  return out
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
const refinedCache = new Map<string, Promise<RefinedDoc | null>>()

/** Fetches and validates `extended.json`; `sha256` is not recomputed in the browser (tests check it). */
export function loadHeader(siteId: string, baseUrl = defaultBase()): Promise<ExtendedHeader> {
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

/**
 * 0.1° horizons of the site's revalidated map cells (cached per site). `null` when the site has no
 * `refined.json`. An invalid or stale file (another `cells.bin`) is never used: it is ignored with a
 * console warning and the cells keep their 1° screening horizon.
 */
export function loadRefined(siteId: string, baseUrl = defaultBase()): Promise<RefinedDoc | null> {
  return cached(refinedCache, `${baseUrl}/${siteId}`, async () => {
    const response = await fetch(`${baseUrl}/${siteId}/refined.json`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`${baseUrl}/${siteId}/refined.json: HTTP ${response.status}`)
    const doc: unknown = await response.json()
    const issues = validateRefined(doc, siteId, await loadHeader(siteId, baseUrl))
    if (issues.length) {
      console.warn(`${issues.join('; ')}. Ignored; map cells keep the 1° screening horizon.`)
      return null
    }
    return doc as RefinedDoc
  }).catch((error: unknown) => {
    console.warn(`${siteId}/refined.json not used: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })
}
