/** B/D boundary: validate an uploaded folder or a generated service response before adding a site.
 * Files are supplied as bytes, so this works with uploaded files, fetched responses, or a future worker.
 * This module never changes the catalogue or silently snaps a coordinate.
 */
import type { SiteData } from './contract.ts'
import { parseYear, validateExtendedHeader, type ExtendedHeader } from './extended.ts'
import { validateEphemeris, validateHorizon, validateSites, validateTerrain } from './validate.ts'

export const PACKAGE_FILES = ['site.json', 'horizon.json', 'terrain.json', 'ephemeris.json', 'year.bin', 'extended.json'] as const
type FileName = typeof PACKAGE_FILES[number]
export interface ScientificManifest {
  version: 1
  kind: 'lunar-scientific-package'
  siteId: string
  observer: { latDeg: number; lonDeg: number; eyeM: number }
  coverage: { startUtc: string; endUtc: string; stepS: number; count: number }
  ephemeris: { startUtc: string; stepS: number; count: number; source: string }
  horizonResolutionDeg: number
  warnings: string[]
  files: Record<FileName, { sha256: string; bytes: number }>
}
export interface ScientificPackage { manifest: ScientificManifest; header: ExtendedHeader; data: SiteData }

const decode = (b: ArrayBuffer, name: string): unknown => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) }
  catch { throw new Error(`${name}: invalid UTF-8 JSON`) }
}
const bad = (message: string): never => { throw new Error(`package.json: ${message}`) }

/** All six hashes and sizes are checked before any scientific file is consumed. */
export async function parseScientificPackage(files: Record<string, ArrayBuffer>): Promise<ScientificPackage> {
  if (!files['package.json']) bad('missing manifest')
  const m = decode(files['package.json'], 'package.json') as ScientificManifest
  if (!m || m.version !== 1 || m.kind !== 'lunar-scientific-package' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(m.siteId)) bad('unsupported version, kind or siteId')
  if (!Array.isArray(m.warnings) || !m.warnings.every(w => typeof w === 'string')) bad('warnings must be strings')
  if (!m.files || !m.observer || !m.coverage || !m.ephemeris) bad('missing files, observer or time metadata')
  await Promise.all(PACKAGE_FILES.map(async name => {
    const bytes = files[name], meta = m.files[name]
    if (!bytes || !meta || !Number.isSafeInteger(meta.bytes) || bytes.byteLength !== meta.bytes) bad(`${name}: missing file or byte-length mismatch`)
    if (!/^[a-f0-9]{64}$/.test(meta.sha256)) bad(`${name}: invalid sha256`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
    if (hash !== meta.sha256) bad(`${name}: sha256 mismatch`)
  }))
  const header = decode(files['extended.json'], 'extended.json') as ExtendedHeader
  const issues = validateExtendedHeader(header, m.siteId)
  if (issues.length) throw new Error(issues.join('; '))
  if (header.version !== 1 || header.year.source !== m.ephemeris.source) bad('unsupported version or inconsistent ephemeris source')
  for (const key of ['startUtc', 'endUtc', 'stepS', 'count'] as const) {
    if (header.year[key] !== m.coverage[key]) bad(`coverage.${key} differs from extended.json`)
  }
  if (['latDeg', 'lonDeg', 'eyeM'].some(k => header.year.observer[k as keyof typeof m.observer] !== m.observer[k as keyof typeof m.observer])) bad('observer differs from extended.json')
  if (header.year.sha256 !== m.files['year.bin'].sha256) bad('year.bin hash differs from extended.json')
  const main = m.ephemeris
  const end = new Date(Date.parse(main.startUtc) + (main.count - 1) * main.stepS * 1000).toISOString()
  const coverage = { startUtc: main.startUtc, endUtc: end, stepS: main.stepS }
  const site = validateSites({ version: 1, coverage, sites: [decode(files['site.json'], 'site.json')] }, 'site.json').sites[0]
  if (site.id !== m.siteId || site.latDeg !== m.observer.latDeg || site.lonDeg !== m.observer.lonDeg || Math.abs(site.surfaceElevationM + site.observerHeightM - m.observer.eyeM) > .011) bad('observer differs from site.json')
  const hzInput = decode(files['horizon.json'], 'horizon.json') as { observer?: typeof m.observer }
  if (!hzInput?.observer || (['latDeg', 'lonDeg', 'eyeM'] as const).some(k => Math.abs(hzInput.observer![k] - m.observer[k]) > 1e-8 || !Number.isFinite(hzInput.observer![k]))) bad('horizon observer differs from extended.json')
  const horizon = validateHorizon(hzInput, site.id)
  if (horizon.azStepDeg !== m.horizonResolutionDeg) bad('horizon resolution differs from horizon.json')
  const terrain = validateTerrain(decode(files['terrain.json'], 'terrain.json'), site.id)
  const ephemeris = validateEphemeris(decode(files['ephemeris.json'], 'ephemeris.json'), site, coverage)
  if (ephemeris.count !== main.count || ephemeris.source !== main.source || main.stepS !== m.coverage.stepS ||
      main.startUtc !== m.coverage.startUtc || Date.parse(end) > Date.parse(m.coverage.endUtc)) bad('main ephemeris falls outside declared coverage')
  // Simulation receives the complete series. The short JSON is retained only in the manifest.
  const year = parseYear(site.id, header, files['year.bin'])
  for (const body of ['sun', 'earth'] as const) {
    if (year[body].azDeg.some(n => n < 0 || n > 360) || year[body].elDeg.some(n => n < -90 || n > 90) || year[body].distanceM.some(n => n <= 0)) bad(`${body}: invalid physical values in year.bin`)
    for (const field of ['azDeg', 'elDeg', 'distanceM'] as const) {
      const tolerance = field === 'distanceM' ? (body === 'sun' ? 20000 : 600) : .0001
      for (let i = 0; i < main.count; i++) {
        const delta = year[body][field][i] - ephemeris[body][field][i]
        const error = field === 'azDeg' ? Math.abs(((delta + 540) % 360) - 180) : Math.abs(delta)
        if (error > tolerance) bad(`${body}.${field}: main ephemeris differs from year.bin at sample ${i}`)
      }
    }
  }
  return { manifest: m, header, data: { site, ephemeris: year, horizon, terrain,
    provenance: { latDeg: site.latDeg, lonDeg: site.lonDeg, observerHeightM: site.observerHeightM,
      eyeM: m.observer.eyeM, horizonResolutionDeg: horizon.azStepDeg, horizonSource: 'catalogue',
      ephemerisSource: year.source, dataHash: header.year.sha256, precision: 'catalogue', coverageWarnings: [...m.warnings] } } }
}
