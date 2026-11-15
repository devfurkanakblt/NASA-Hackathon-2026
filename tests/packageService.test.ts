/// <reference types="node" />
/**
 * D: scientific package service adapter and engine wiring (docs/ekip-notlari.md, D section):
 * published/uploaded/generated packages are validated before use, never replace a catalogue
 * point, run through the unchanged engine and the searches over their own (multi-year) period,
 * and cancellation is reported, never a partial package.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseCells, parseYear, type ExtendedHeader, type RefinedDoc } from '../src/data/extended.ts'
import {
  AbortError,
  ALL_PACKAGE_FILES,
  STATIC_APP_SERVICE,
  customPointArgs,
  fetchPackageIndex,
  fetchScientificPackage,
  filesFromUpload,
  registerPackage,
  runGeneration,
  validateGenerationRequest,
  type GenerationRequest,
} from '../src/data/packageService.ts'
import { parseScientificPackage } from '../src/data/scientificPackage.ts'
import { resolveSiteData, sitesNeeded } from '../src/app/extendedSites.ts'
import { cellSiteData, REFINED_CELL_LABEL } from '../src/sim/cell.ts'
import { CoverageError, DEFAULT_SETTINGS, evaluateScenario, missionStartRange } from '../src/sim/evaluate.ts'
import { cellPlaces, findDatesForPlace, findPlacesForDate } from '../src/sim/search.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const RIDGE = 'packages/ConnectingRidge2026to2029/'
const bytes = (path: string) => {
  const b = readFileSync(DATA + path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA + path, 'utf8')) as T
const ridgeFiles = () => Object.fromEntries(ALL_PACKAGE_FILES.map((n) => [n, bytes(RIDGE + n)]))

/** fetch served from public/data; `base/x` → public/data/x. */
function serveData(base = 'D') {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push(url)
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const buf = bytes(url.slice(base.length + 1))
      return { ok: true, status: 200, arrayBuffer: async () => buf }
    } catch {
      return { ok: false, status: 404 }
    }
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('published packages', () => {
  it('loads the three-year Connecting Ridge package from packages.json with progress', async () => {
    serveData()
    const index = await fetchPackageIndex('D')
    const entry = index.find((p) => p.siteId === 'ConnectingRidge2026to2029')!
    const progress: number[] = []
    const pkg = await fetchScientificPackage(entry, 'D', { onProgress: (d) => progress.push(d) })
    expect(progress.at(-1)).toBe(7)
    expect(pkg.manifest.coverage.endUtc).toBe('2029-11-01T00:00:00Z')
    expect(pkg.data.ephemeris.count).toBe(157825)
  })

  it('refuses a manifest whose hash differs from packages.json', async () => {
    serveData()
    const entry = (await fetchPackageIndex('D')).find((p) => p.siteId === 'ConnectingRidge2026to2029')!
    await expect(fetchScientificPackage({ ...entry, manifestSha256: '0'.repeat(64) }, 'D')).rejects.toThrow(/sha256 differs from packages.json/)
  })

  it('cancellation is an AbortError, not a partial package', async () => {
    serveData()
    const entry = (await fetchPackageIndex('D')).find((p) => p.siteId === 'ConnectingRidge2026to2029')!
    const ctl = new AbortController()
    ctl.abort()
    await expect(fetchScientificPackage(entry, 'D', { signal: ctl.signal })).rejects.toBeInstanceOf(AbortError)
  })

  it('refuses index paths outside the data folder', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ version: 1, packages: [{ siteId: 'X', manifest: '../x/package.json', manifestSha256: 'a'.repeat(64), coverage: {}, observer: {} }] })).buffer }))
    await expect(fetchPackageIndex('D')).rejects.toThrow(/outside the data folder/)
  })
})

describe('upload', () => {
  const file = (name: string, buf: ArrayBuffer) => ({ name, arrayBuffer: async () => buf })
  it('collects the seven files of a picked folder and ignores others', async () => {
    const f = ridgeFiles()
    const picked = [...Object.entries(f).map(([n, b]) => file(`ConnectingRidge2026to2029/${n}`, b)), file('notes.txt', new ArrayBuffer(1))]
    const files = await filesFromUpload(picked)
    expect(Object.keys(files).sort()).toEqual([...ALL_PACKAGE_FILES].sort())
    expect((await parseScientificPackage(files)).data.site.id).toBe('ConnectingRidge2026to2029')
  })
  it('names missing files', async () => {
    await expect(filesFromUpload([file('package.json', new ArrayBuffer(1))])).rejects.toThrow(/missing site.json, horizon.json/)
  })
})

describe('engine wiring of a multi-year package', () => {
  const sites = read<SitesDoc>('sites.json')

  it('registers without replacing a catalogue site; a different package with the same id is refused', async () => {
    const pkg = await parseScientificPackage(ridgeFiles())
    const catalogue = { Site01: { site: sites.sites.find((s) => s.id === 'Site01')! } as SiteData }
    const bySite = registerPackage(catalogue, pkg)
    expect(Object.keys(bySite)).toEqual(['Site01', 'ConnectingRidge2026to2029'])
    expect(registerPackage(bySite, pkg)).toBe(bySite) // same data hash: no-op
    const other = { ...pkg, data: { ...pkg.data, provenance: { ...pkg.data.provenance!, dataHash: 'f'.repeat(64) } } }
    expect(() => registerPackage(bySite, other)).toThrow(/different package/)
    const clash = { ...pkg, data: { ...pkg.data, site: { ...pkg.data.site, id: 'Site01' } } }
    expect(() => registerPackage(bySite, clash)).toThrow(/catalogue site/)
  })

  it('resolves a 2029 start without loading year.bin; last valid start passes, one step later is CoverageError', async () => {
    const pkg = await parseScientificPackage(ridgeFiles())
    const bySite = { [pkg.data.site.id]: pkg.data }
    const id = pkg.data.site.id
    const catalogueEnd = '2027-01-01T00:00:00Z'
    const r = resolveSiteData(id, '2029-03-01T00:00:00Z', catalogueEnd, bySite, { years: {}, cells: {} }, 7)
    expect('data' in r && r.data).toBe(pkg.data)
    expect(sitesNeeded([{ siteId: id, startUtc: '2029-03-01T00:00:00Z' }], catalogueEnd, 7, bySite)).toEqual({ years: [], cells: [], points: [] })
    const range = missionStartRange(pkg.data.ephemeris, 7)!
    expect(range).toEqual({ firstStartUtc: '2026-11-01T00:00:00Z', lastStartUtc: '2029-10-25T00:00:00Z' })
    expect(evaluateScenario(pkg.data, range.lastStartUtc, DEFAULT_SETTINGS).count).toBe(1009)
    expect(() => evaluateScenario(pkg.data, '2029-10-25T00:10:00Z', DEFAULT_SETTINGS)).toThrow(CoverageError)
    expect(missionStartRange({ ...pkg.data.ephemeris, count: 100 }, 7)).toBeNull()
  })

  it('date search over the three years: labelled as the package, best equals the direct run, outside starts reported', async () => {
    const pkg = await parseScientificPackage(ridgeFiles())
    const r = await findDatesForPlace({ data: pkg.data, settings: DEFAULT_SETTINGS, fromUtc: '2026-11-01T00:00:00Z', toUtc: '2029-11-01T00:00:00Z', coarseStepS: 7 * 86400 })
    expect(r.status).toBe('complete')
    expect(r.failureCounts.coverage).toBe(1) // the 2029-10-31 start would end after the data
    const all = [...r.feasible, ...r.rejected]
    expect(all.some((c) => c.startUtc.startsWith('2029-'))).toBe(true)
    expect(r.best!.precisionLabel).toBe('Scientific package ConnectingRidge2026to2029: 0.1° terrain horizon')
    expect(r.best!.summary).toEqual(evaluateScenario(pkg.data, r.best!.startUtc, DEFAULT_SETTINGS).summary)
  })
})

describe('generation requests', () => {
  const ok: GenerationRequest = { version: 1, id: 'MyPoint', latDeg: -89.4632, lonDeg: 222.51, startUtc: '2026-11-01T00:00:00Z', endUtc: '2029-11-01T00:00:00Z', terrain: 'local5m', ephemerisSource: 'skyfield' }

  it('accepts a valid request and builds an argument array with a normalised longitude', () => {
    expect(validateGenerationRequest(ok, ['Site01'])).toEqual([])
    expect(customPointArgs(ok)).toEqual(['-m', 'preprocess.custom_point', '--id', 'MyPoint', '--lat', '-89.4632', '--lon', '-137.49', '--start', '2026-11-01T00:00:00Z', '--stop', '2029-11-01T00:00:00Z', '--terrain', 'local5m', '--source', 'skyfield'])
  })

  const cases: [string, Partial<GenerationRequest>, RegExp][] = [
    ['reserved id', { id: 'Site01' }, /already used/],
    ['bad id', { id: '1abc; rm -rf' }, /must start with a letter/],
    ['latitude', { latDeg: -91 }, /Latitude/],
    ['NaN longitude', { lonDeg: Number.NaN }, /Longitude/],
    ['off grid', { startUtc: '2026-11-01T00:05:00Z' }, /10-minute/],
    ['local time', { endUtc: '2029-11-01T00:00:00' }, /UTC times/],
    ['too long', { endUtc: '2032-01-01T00:00:00Z' }, /at most 1830 days/],
    ['after 2040', { startUtc: '2039-06-01T00:00:00Z', endUtc: '2040-06-01T00:00:00Z' }, /2000-01-01 and 2040-01-01/],
    ['reversed', { startUtc: '2029-11-01T00:00:00Z', endUtc: '2026-11-01T00:00:00Z' }, /after the start/],
    ['5 m at the equator', { latDeg: 0.67 }, /5 m terrain exists only near the south pole/],
    ['regional at the equator', { latDeg: 0.67, terrain: 'regional' }, /south of 80°S/],
  ]
  for (const [name, patch, message] of cases) {
    it(`refuses: ${name}`, () => {
      expect(validateGenerationRequest({ ...ok, ...patch }, ['Site01']).join(' ')).toMatch(message)
    })
  }
  it('global terrain is allowed anywhere', () => {
    expect(validateGenerationRequest({ ...ok, latDeg: 0.67, lonDeg: 180, terrain: 'global' })).toEqual([])
  })

  it('runs through a service, accepts only the requested point and period, and passes cancellation on', async () => {
    const request = { ...ok, id: 'ConnectingRidge2026to2029' }
    const service = { generate: vi.fn(async () => ridgeFiles()) }
    const pkg = await runGeneration(service, request, ['Site01'])
    expect(pkg.data.site.id).toBe('ConnectingRidge2026to2029')
    await expect(runGeneration(service, { ...request, latDeg: -89.4 }, [])).rejects.toThrow(/another coordinate/)
    await expect(runGeneration(service, { ...request, endUtc: '2028-11-01T00:00:00Z' }, [])).rejects.toThrow(/not the requested period/)
    const ctl = new AbortController()
    const slow = { generate: async () => { ctl.abort(); return ridgeFiles() } }
    await expect(runGeneration(slow, request, [], { signal: ctl.signal })).rejects.toBeInstanceOf(AbortError)
    await expect(runGeneration(service, { ...request, id: 'Site01' }, ['Site01'])).rejects.toThrow(/already used/)
  })

  it('the static app says plainly that it cannot generate', async () => {
    await expect(runGeneration(STATIC_APP_SERVICE, ok, [])).rejects.toThrow(/not generated in the browser.*custom_point/)
  })
})

describe('search over map cells with A’s cache and refined finalists', () => {
  const sites = read<SitesDoc>('sites.json')
  const base: SiteData = { site: sites.sites.find((s) => s.id === 'Site01')!, ephemeris: read('Site01/ephemeris.json'), horizon: read('Site01/horizon.json'), map: read<MapDoc>('Site01/map.json') }
  const header = read<ExtendedHeader>('Site01/extended.json')
  const year = parseYear('Site01', header, bytes('Site01/year.bin'))
  const cells = parseCells(header, bytes('Site01/cells.bin'))
  const refined = read<RefinedDoc>('Site01/refined.json')
  const startUtc = '2027-02-10T06:00:00Z'
  const pick = new Set(['36,32', '30,30', '36,33', '10,10'])
  const filter = (r: number, c: number) => pick.has(`${r},${c}`)

  it('refined cells use the 0.1° horizon and equal the full cellSiteData run; others stay screening with a refine suggestion', async () => {
    const places = cellPlaces(base, year, cells, { header, refined, filter })
    expect(places.map((p) => [p.siteId, p.precision])).toEqual([
      ['Site01:r10c10', 'cell'],
      ['Site01:r30c30', 'refined'],
      ['Site01:r36c32', 'refined'],
      ['Site01:r36c33', 'cell'],
    ])
    const r = await findPlacesForDate({ places, settings: DEFAULT_SETTINGS, startUtc })
    const all = [...r.feasible, ...r.rejected]
    const ridge = all.find((c) => c.siteId === 'Site01:r36c32')!
    expect(ridge.precisionLabel).toBe(REFINED_CELL_LABEL)
    const full = evaluateScenario(cellSiteData(base, year, cells, header, 36, 32, refined), startUtc, DEFAULT_SETTINGS)
    for (const k of ['sunVisibleFraction', 'earthVisibleFraction', 'minSocFraction', 'longestEarthOutageS'] as const) expect(ridge.summary![k], k).toBeCloseTo(full.summary[k], 9)
    for (const s of r.refineSuggestions) for (const c of s.cells) expect(['r10c10', 'r36c33']).toContain(c)
    expect(r.notes.join(' ')).toMatch(/revalidated with the 0.1° catalogue horizon/)
  })

  it('A’s shared Moon-fixed cache gives the same numbers as the per-object cache', async () => {
    const a = await findPlacesForDate({ places: cellPlaces(base, year, cells, { header, filter }), settings: DEFAULT_SETTINGS, startUtc })
    const b = await findPlacesForDate({ places: cellPlaces(base, year, cells, filter), settings: DEFAULT_SETTINGS, startUtc })
    const pick2 = (x: typeof a) => [...x.feasible, ...x.rejected].map((c) => [c.siteId, c.summary?.minSocFraction, c.summary?.longestEarthOutageS]).sort()
    expect(pick2(a)).toEqual(pick2(b))
  })
})
