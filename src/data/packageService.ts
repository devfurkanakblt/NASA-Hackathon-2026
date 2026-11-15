/**
 * Scientific package service adapter (D): the engine side of A's package boundary
 * (`parseScientificPackage`, docs/data-contract.md → "Portable scientific package").
 *
 * - `fetchPackageIndex` / `fetchScientificPackage`: load a published package (packages.json),
 *   with progress and cancellation; the manifest must match the hash in the index.
 * - `filesFromUpload`: a folder the user picked, as the `Record<string, ArrayBuffer>` the parser wants.
 * - `validateGenerationRequest` / `customPointArgs` / `runGeneration`: the request for a new
 *   coordinate package, checked with the same rules as `python -m preprocess.custom_point`, turned
 *   into an argument array (never a shell string) and run through a pluggable service; the result
 *   is accepted only after the full package validation. The static app has no service:
 *   `STATIC_APP_SERVICE` says so instead of pretending.
 * - `registerPackage`: adds a parsed package to the site table without ever replacing a catalogue
 *   point or another package with the same id.
 *
 * B owns the upload / generation UI and its progress / cancel controls; this module owns the wiring.
 */
import type { SiteData } from './contract.ts'
import { PACKAGE_FILES, parseScientificPackage, type ScientificPackage } from './scientificPackage.ts'

export const PACKAGE_MANIFEST = 'package.json'
export const ALL_PACKAGE_FILES = [PACKAGE_MANIFEST, ...PACKAGE_FILES] as const

export interface PackageIndexEntry {
  siteId: string
  /** Relative to the data folder, e.g. `packages/ConnectingRidge2026to2029/package.json`. */
  manifest: string
  manifestSha256: string
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  observer: { latDeg: number; lonDeg: number; eyeM: number }
  horizonResolutionDeg: number
}

export interface LoadOptions {
  signal?: AbortSignal
  /** Files received / files needed. */
  onProgress?: (done: number, total: number) => void
}

const defaultBase = () => `${import.meta.env.BASE_URL}data`

export class AbortError extends Error {
  constructor(message = 'Cancelled.') {
    super(message)
    this.name = 'AbortError'
  }
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AbortError()
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, '0')).join('')
}

async function getBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (e) {
    if (signal?.aborted) throw new AbortError()
    throw e
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

/** `packages.json`: the published packages. Entries with a missing field are refused, not skipped. */
export async function fetchPackageIndex(baseUrl = defaultBase(), opts: LoadOptions = {}): Promise<PackageIndexEntry[]> {
  const buf = await getBytes(`${baseUrl}/packages.json`, opts.signal)
  const doc = JSON.parse(new TextDecoder().decode(buf)) as { version?: number; packages?: PackageIndexEntry[] }
  if (doc.version !== 1 || !Array.isArray(doc.packages)) throw new Error('packages.json: unsupported version or no package list.')
  for (const p of doc.packages) {
    if (typeof p.siteId !== 'string' || typeof p.manifest !== 'string' || !/^[a-f0-9]{64}$/.test(p.manifestSha256 ?? '') || !p.coverage || !p.observer) {
      throw new Error(`packages.json: entry ${JSON.stringify(p.siteId)} is incomplete.`)
    }
    if (p.manifest.includes('..') || p.manifest.startsWith('/')) throw new Error(`packages.json: entry ${p.siteId} points outside the data folder.`)
  }
  return doc.packages
}

/** Fetches the seven files of a published package and validates it (hashes, observer, coverage, values). */
export async function fetchScientificPackage(entry: PackageIndexEntry, baseUrl = defaultBase(), opts: LoadOptions = {}): Promise<ScientificPackage> {
  const folder = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1)
  const files: Record<string, ArrayBuffer> = {}
  let done = 0
  const total = ALL_PACKAGE_FILES.length
  opts.onProgress?.(0, total)
  checkAbort(opts.signal)
  files[PACKAGE_MANIFEST] = await getBytes(`${baseUrl}/${entry.manifest}`, opts.signal)
  if ((await sha256Hex(files[PACKAGE_MANIFEST])) !== entry.manifestSha256) throw new Error(`${entry.manifest}: sha256 differs from packages.json.`)
  opts.onProgress?.(++done, total)
  await Promise.all(
    PACKAGE_FILES.map(async (name) => {
      files[name] = await getBytes(`${baseUrl}/${folder}${name}`, opts.signal)
      opts.onProgress?.(++done, total)
    }),
  )
  checkAbort(opts.signal)
  const pkg = await parseScientificPackage(files)
  if (pkg.manifest.siteId !== entry.siteId) throw new Error(`${entry.manifest}: siteId ${pkg.manifest.siteId} differs from packages.json (${entry.siteId}).`)
  return pkg
}

/** Files of a picked folder (`<input webkitdirectory>` or drag and drop), keyed by base name. Unknown names are ignored; duplicates are refused. */
export async function filesFromUpload(files: ArrayLike<{ name: string; arrayBuffer(): Promise<ArrayBuffer> }>): Promise<Record<string, ArrayBuffer>> {
  const out: Record<string, ArrayBuffer> = {}
  const wanted = new Set<string>(ALL_PACKAGE_FILES)
  for (const f of Array.from(files)) {
    const name = f.name.slice(f.name.lastIndexOf('/') + 1)
    if (!wanted.has(name)) continue
    if (out[name]) throw new Error(`${name} was selected twice.`)
    out[name] = await f.arrayBuffer()
  }
  const missing = ALL_PACKAGE_FILES.filter((n) => !out[n])
  if (missing.length > 0) throw new Error(`The folder is missing ${missing.join(', ')}.`)
  return out
}

/** Adds a package to the site table. Never replaces a catalogue point or a different package with the same id. */
export function registerPackage(bySite: Record<string, SiteData>, pkg: ScientificPackage): Record<string, SiteData> {
  const id = pkg.data.site.id
  const existing = bySite[id]
  if (existing) {
    const same = existing.provenance?.dataHash && existing.provenance.dataHash === pkg.data.provenance?.dataHash
    if (same) return bySite
    throw new Error(existing.site.category === 'custom' ? `A different package named ${id} is already loaded; remove it first.` : `${id} is a catalogue site; a package cannot replace it.`)
  }
  return { ...bySite, [id]: pkg.data }
}

// ---------------------------------------------------------------------------------------------
// Generation requests (python -m preprocess.custom_point)

export type TerrainChoice = 'local5m' | 'regional' | 'global'
export type EphemerisChoice = 'skyfield' | 'horizons'

export interface GenerationRequest {
  version: 1
  id: string
  latDeg: number
  lonDeg: number
  startUtc: string
  endUtc: string
  terrain: TerrainChoice
  ephemerisSource: EphemerisChoice
}

export const GENERATION_LIMITS = {
  earliestUtc: '2000-01-01T00:00:00Z',
  latestUtc: '2040-01-01T00:00:00Z',
  maxDays: 1830,
  stepS: 600,
} as const

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/

/** Longitude in (−180, 180]. */
export const normalizeLonDeg = (lon: number) => {
  const x = ((lon % 360) + 360) % 360
  return x > 180 ? x - 360 : x
}

/**
 * Problems with a generation request, one English sentence each (empty: can be sent).
 * Mirrors the generator's rules; nothing is snapped or clamped. `reservedIds`: catalogue ids
 * and loaded packages.
 */
export function validateGenerationRequest(r: GenerationRequest, reservedIds: Iterable<string> = []): string[] {
  const issues: string[] = []
  if (r.version !== 1) issues.push('Unsupported request version.')
  if (typeof r.id !== 'string' || !ID.test(r.id)) issues.push('Name must start with a letter and have 1–32 letters, digits, “_” or “-”.')
  else if (new Set(reservedIds).has(r.id)) issues.push(`The name ${r.id} is already used by a site or package.`)
  if (!Number.isFinite(r.latDeg) || r.latDeg < -90 || r.latDeg > 90) issues.push('Latitude must be between −90° and 90°.')
  if (!Number.isFinite(r.lonDeg)) issues.push('Longitude must be a number of degrees.')
  if (!['local5m', 'regional', 'global'].includes(r.terrain)) issues.push('Terrain must be local5m, regional or global.')
  if (!['skyfield', 'horizons'].includes(r.ephemerisSource)) issues.push('Ephemeris source must be skyfield or horizons.')
  const t = (v: string) => (typeof v === 'string' && UTC.test(v) ? Date.parse(v) : NaN)
  const a = t(r.startUtc)
  const b = t(r.endUtc)
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    issues.push('Start and end must be UTC times like 2026-11-01T00:00:00Z.')
  } else {
    const step = GENERATION_LIMITS.stepS * 1000
    if (a % step !== 0 || b % step !== 0) issues.push('Start and end must lie on the 10-minute UTC grid.')
    if (a < Date.parse(GENERATION_LIMITS.earliestUtc) || b > Date.parse(GENERATION_LIMITS.latestUtc)) issues.push('Dates must lie between 2000-01-01 and 2040-01-01 UTC.')
    if (b <= a) issues.push('The end must be after the start.')
    else if ((b - a) / 86400000 > GENERATION_LIMITS.maxDays) issues.push(`A package covers at most ${GENERATION_LIMITS.maxDays} days.`)
  }
  if (r.terrain === 'local5m' && Number.isFinite(r.latDeg) && r.latDeg > -80) issues.push('The 5 m terrain exists only near the south pole; choose regional (south of 80°S) or global (any point, ~474 m terrain).')
  if (r.terrain === 'regional' && Number.isFinite(r.latDeg) && r.latDeg > -80) issues.push('Regional terrain is only available south of 80°S.')
  return issues
}

/** The generator's argument array for a valid request. Run it as an array (never through a shell). */
export function customPointArgs(r: GenerationRequest): string[] {
  const issues = validateGenerationRequest(r)
  if (issues.length > 0) throw new RangeError(issues.join(' '))
  return [
    '-m', 'preprocess.custom_point',
    '--id', r.id,
    '--lat', String(r.latDeg),
    '--lon', String(normalizeLonDeg(r.lonDeg)),
    '--start', r.startUtc,
    '--stop', r.endUtc,
    '--terrain', r.terrain,
    '--source', r.ephemerisSource,
  ]
}

/** A service that runs the generator and returns the completed folder's files. */
export interface GenerationService {
  generate(request: GenerationRequest, opts: LoadOptions): Promise<Record<string, ArrayBuffer>>
}

/** The deployed static app: no generator runs in the browser. */
export const STATIC_APP_SERVICE: GenerationService = {
  generate: () =>
    Promise.reject(
      new Error('New points are not generated in the browser. Run python -m preprocess.custom_point with these settings, then import the folder.'),
    ),
}

/**
 * Validates the request, runs it on `service`, then accepts the result only after the full
 * package validation and a check that it is the point and period that was asked for.
 * Cancellation is passed to the service and reported as `AbortError`; nothing partial is returned.
 */
export async function runGeneration(service: GenerationService, request: GenerationRequest, reservedIds: Iterable<string>, opts: LoadOptions = {}): Promise<ScientificPackage> {
  const issues = validateGenerationRequest(request, reservedIds)
  if (issues.length > 0) throw new RangeError(issues.join(' '))
  checkAbort(opts.signal)
  const files = await service.generate(request, opts)
  checkAbort(opts.signal)
  const pkg = await parseScientificPackage(files)
  const m = pkg.manifest
  const lon = normalizeLonDeg(request.lonDeg)
  const problems: string[] = []
  if (m.siteId !== request.id) problems.push(`the package is named ${m.siteId}, not ${request.id}`)
  if (Math.abs(m.observer.latDeg - request.latDeg) > 1e-9 || Math.abs(normalizeLonDeg(m.observer.lonDeg) - lon) > 1e-9) problems.push('the package is for another coordinate')
  if (m.coverage.startUtc !== request.startUtc || m.coverage.endUtc !== request.endUtc) problems.push(`the package covers ${m.coverage.startUtc} to ${m.coverage.endUtc}, not the requested period`)
  if (problems.length > 0) throw new Error(`Generated package refused: ${problems.join('; ')}.`)
  return pkg
}
