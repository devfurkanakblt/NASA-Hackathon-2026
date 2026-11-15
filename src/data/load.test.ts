/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAllData } from './load.ts'
import { EARTH_TEXTURE_FRAME, TERRAIN_FRAME } from './validate.ts'

const startUtc = '2026-11-01T00:00:00Z'
const endUtc = '2026-11-01T00:20:00Z'

function fixture(id = 'Site01') {
  const site = { id, name: 'Research example', latDeg: -89, lonDeg: 12, surfaceElevationM: 100,
    observerHeightM: 2, coordSource: 'NASA catalogue', demNear: 'NASA LOLA 5m', demFar: 'NASA LOLA 80m',
    label: 'Not a certified landing site', warnings: [], category: undefined as string | undefined }
  const body = { azDeg: [359.9, 0, 0.1], elDeg: [-1, 0, 1], distanceM: [1e11, 1e11, 1e11] }
  const ephemeris = { version: 1, siteId: id, source: 'jpl-horizons', generatedUtc: startUtc,
    settings: { center: 'coord@301', frame: 'MOON_ME', refraction: false, observerHeightM: 2 },
    startUtc, stepS: 600, count: 3, sun: structuredClone(body), earth: structuredClone(body) }
  const horizon = { version: 1, siteId: id, azStepDeg: 90, count: 4,
    elevDeg: [1, 2, 3, 4], distanceM: [100, 200, 300, 400],
    params: { nearRangeM: 7000, nearStepM: 2.5, maxRangeM: 250000, farStepM: 40, minRangeM: 10, curvature: true }, warnings: [] }
  const terrain = { version: 1, siteId: id, frame: TERRAIN_FRAME, sizeM: 20, n: 2, cellM: 10, zM: [-2, -1, 0, 1] }
  const orientation = { version: 1, siteId: id, startUtc, stepS: 600, count: 3,
    quaternionXyzw: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
    sunDirectionAtEarth: [[1, 0, 0], [1, 0, 0], [1, 0, 0]],
    source: { method: 'Skyfield, Earth emission time', textureBodyFrame: EARTH_TEXTURE_FRAME,
      site: { latitudeDeg: site.latDeg, longitudeDeg: site.lonDeg, surfaceElevationM: site.surfaceElevationM, observerHeightM: site.observerHeightM } } }
  const sites = { version: 1, coverage: { startUtc, endUtc, stepS: 600 }, sites: [site] }
  const docs: Record<string, unknown> = {
    '/data/sites.json': sites,
    [`/data/${id}/ephemeris.json`]: ephemeris,
    [`/data/${id}/horizon.json`]: horizon,
    [`/data/${id}/terrain.json`]: terrain,
    [`/data/${id}/earth-orientation.json`]: orientation,
  }
  return { id, sites, ephemeris, horizon, terrain, orientation, docs }
}

function mockFiles(docs: Record<string, unknown>, failures: Record<string, number | Error> = {}) {
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const failure = failures[url]
    if (failure instanceof Error) throw failure
    const status = typeof failure === 'number' ? failure : Object.hasOwn(docs, url) ? 200 : 404
    return { ok: status === 200, status, json: async () => structuredClone(docs[url]) } as Response
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

function imageryFixture(site: ReturnType<typeof fixture>['sites']['sites'][number], far = false) {
  return { version: 1, siteId: site.id, file: far ? 'lunar-imagery-far.jpg' : 'lunar-imagery.jpg',
    sizeM: 20, width: 1024, height: 1024, frame: 'local-east-north-metres-image-north-up',
    archiveShadows: true, sha256: 'b'.repeat(64), source: {
      url: 'https://trek.nasa.gov/moon/', name: 'NASA archival LROC mosaic', nativePixelM: 100,
      acquisition: 'Archival composite', crs: 'local ENU', transform: [0, 1, 0, 0, 0, -1],
      resampling: 'bilinear', limitations: ['Archive shadows do not represent selected mission time.'],
      site: { latitudeDeg: site.latDeg, longitudeDeg: site.lonDeg, surfaceElevationM: site.surfaceElevationM, observerHeightM: site.observerHeightM },
    } }
}

describe('registered archival lunar photography', () => {
  it('attaches local and regional images independently without changing elevations or scientific data', async () => {
    const f = fixture()
    f.docs['/data/Site01/lunar-imagery.json'] = imageryFixture(f.sites.sites[0])
    f.docs['/data/Site01/terrain-far.json'] = structuredClone(f.terrain)
    f.docs['/data/Site01/lunar-imagery-far.json'] = imageryFixture(f.sites.sites[0], true)
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain?.imagery?.textureUrl).toBe('/data/Site01/lunar-imagery.jpg?v=' + 'b'.repeat(64))
    expect(data.terrainFar?.imagery?.textureUrl).toContain('lunar-imagery-far.jpg?v=')
    expect(data.terrain?.zM).toEqual(f.terrain.zM)
    expect(data.ephemeris).toEqual(f.ephemeris)
    expect(data.visualWarnings).toEqual([])
  })

  it.each(['observer', 'footprint', 'path', 'frame', 'shadows', 'hash', 'dimensions', 'provenance', 'missingPixels'])('omits invalid imagery %s while preserving the terrain and science', async kind => {
    const f = fixture()
    const image = imageryFixture(f.sites.sites[0])
    if (kind === 'observer') image.source.site.longitudeDeg++
    if (kind === 'footprint') image.sizeM++
    if (kind === 'path') image.file = '../other.jpg'
    if (kind === 'frame') image.frame = 'global image stretched over local site'
    if (kind === 'shadows') image.archiveShadows = false
    if (kind === 'hash') image.sha256 = ''
    if (kind === 'dimensions') image.width = 100000
    if (kind === 'provenance') image.source.nativePixelM = NaN
    if (kind === 'missingPixels') Object.assign(image.source, { photographicCoverageFraction: 0.99 })
    f.docs['/data/Site01/lunar-imagery.json'] = image
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain?.imagery).toBeUndefined()
    expect(data.terrain?.zM).toEqual(f.terrain.zM)
    expect(data.horizon).toEqual(f.horizon)
    expect(data.visualWarnings?.join(' ')).toMatch(/invalid lunar imagery/)
  })
})

function summaryFiles(id = 'Site01') {
  const summary = (samples: number) => ({ samples, sunPct: 50, earthPct: 40, bothPct: 20,
    sunDiskFractionMean: 0.5, longestNoSunS: 0, longestNoEarthS: 0,
    sunElMaxDeg: 2, sunElMinDeg: -2, earthElMaxDeg: 6 })
  const annualEnd = '2027-11-01T00:00:00Z'
  const count = (Date.parse(annualEnd) - Date.parse(startUtc)) / 600000 + 1
  const months = Array.from({ length: 12 }, (_, i) => {
    const first = Date.UTC(2026, 10 + i, 1)
    const last = Date.UTC(2026, 11 + i, 1)
    const startIndex = (first - Date.parse(startUtc)) / 600000
    const endIndex = (last - Date.parse(startUtc)) / 600000
    return { ...summary(endIndex - startIndex), month: new Date(first).toISOString().slice(0, 7), startIndex, endIndex }
  })
  const season = { version: 1, siteId: id, source: 'jpl-horizons',
    coverage: { startUtc, endUtc: annualEnd, stepS: 600, count },
    year: summary(count), mainPeriod: { ...summary(3), startUtc, endUtc }, months }
  const values = (n: number): (number | null)[] => new Array(9).fill(n)
  const map = { version: 1, siteId: id, grid: { nx: 3, ny: 3, spacingM: 100, halfSizeM: 100 },
    coverage: { startUtc, endUtc, stepS: 600, count: 3 },
    latDeg: new Array(9).fill(-89), lonDeg: new Array(9).fill(12), surfaceElevationM: values(100),
    sunPct: values(50), earthPct: values(40), bothPct: values(20), sunDiskFractionMean: values(0.5),
    longestNoSunS: values(0), longestNoEarthS: values(0), slopeDeg: values(5), warnings: [] }
  return { season, map }
}

describe('map and independent annual season merge regressions', () => {
  it('preserves valid null map metrics and the independent annual coverage', async () => {
    const f = fixture()
    const { map, season } = summaryFiles()
    map.sunPct[0] = null
    map.slopeDeg[4] = null
    map.surfaceElevationM[8] = null
    f.docs['/data/Site01/map.json'] = map
    f.docs['/data/Site01/season.json'] = season
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.map).toEqual(map)
    expect(data.season).toEqual(season)
    expect(data.season?.coverage.endUtc).toBe('2027-11-01T00:00:00Z')
    expect(data.ephemeris.count).toBe(3)
    expect(data.visualWarnings).toEqual([])
  })

  it('opens when the optional map and season files are absent (404)', async () => {
    const f = fixture()
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.map).toBeUndefined()
    expect(data.season).toBeUndefined()
    expect(data.visualWarnings).toEqual([])
  })

  it('does not request a regional map for contrast sites, but still loads their season', async () => {
    const f = fixture('Apollo11')
    f.sites.sites[0].category = 'contrast'
    const { map, season } = summaryFiles(f.id)
    f.docs[`/data/${f.id}/map.json`] = map // would succeed, but must never be requested
    f.docs[`/data/${f.id}/season.json`] = season
    const fetch = mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Apollo11
    expect(data.map).toBeUndefined()
    expect(data.season).toEqual(season)
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain('/data/Apollo11/map.json')
    expect(fetch).toHaveBeenCalledTimes(9)
  })

  it.each(['map', 'season'])('warns on an optional %s network failure without losing science', async (kind) => {
    const f = fixture()
    mockFiles(f.docs, { [`/data/Site01/${kind}.json`]: new Error('offline') })
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data[kind as 'map' | 'season']).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toContain(`${kind}.json: network request failed`)
    expect(data.ephemeris).toEqual(f.ephemeris)
  })

  it.each(['mapLength', 'mapNaN', 'mapSite', 'seasonCoverage', 'seasonSite', 'seasonMonth'])('warns and omits a malformed optional summary: %s', async (kind) => {
    const f = fixture()
    const { map, season } = summaryFiles()
    if (kind === 'mapLength') map.sunPct.pop()
    if (kind === 'mapNaN') map.sunPct[0] = NaN
    if (kind === 'mapSite') map.siteId = 'Site04'
    if (kind === 'seasonCoverage') season.coverage.count--
    if (kind === 'seasonSite') season.siteId = 'Site04'
    if (kind === 'seasonMonth') season.months[1].month = season.months[0].month
    f.docs['/data/Site01/map.json'] = map
    f.docs['/data/Site01/season.json'] = season
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    const field = kind.startsWith('map') ? 'map' : 'season'
    expect(data[field]).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(new RegExp(`${field}\\.json: invalid`))
    expect(data.horizon).toEqual(f.horizon)
  })

  it('warns on malformed optional JSON, rather than treating a broken response as missing', async () => {
    const f = fixture()
    const ordinaryFetch = mockFiles(f.docs)
    vi.stubGlobal('fetch', async (input: string | URL | Request) => String(input).endsWith('/season.json')
      ? { ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON') } } as unknown as Response
      : ordinaryFetch(input))
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.season).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/season.json: response is not valid JSON/)
  })
})

describe('catalogue-driven loading and optional visuals', () => {
  it('does not register an old Earth map after A changes the site coordinate', async () => {
    const f = fixture()
    f.sites.sites[0].lonDeg = 20
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.earthOrientation).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/source.site.longitudeDeg/)
    expect(data.ephemeris.sun.elDeg).toEqual([-1, 0, 1])
  })
  it('accepts a new A site ID, preserves scientific values and handles angular wrap', async () => {
    const f = fixture('Site11-new')
    const fetch = mockFiles(f.docs)
    const loaded = await loadAllData('/data/')
    expect(Object.keys(loaded.bySite)).toEqual(['Site11-new'])
    const data = loaded.bySite[f.id]
    expect(data.ephemeris).toEqual(f.ephemeris)
    expect(data.horizon).toEqual(f.horizon)
    expect(data.earthOrientation).toEqual(f.orientation)
    expect(data.terrainFar).toBeUndefined() // expected optional 404, without a warning
    expect(data.visualWarnings).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(11)
  })

  it('keeps science usable when only the local visual terrain is HTTP 404', async () => {
    const f = fixture()
    mockFiles(f.docs, { '/data/Site01/terrain.json': 404 })
    const { bySite } = await loadAllData('/data')
    expect(bySite.Site01.terrain).toBeUndefined()
    expect(bySite.Site01.ephemeris.sun.elDeg).toEqual([-1, 0, 1])
    expect(bySite.Site01.visualWarnings?.join(' ')).toMatch(/local 3D terrain unavailable/)
  })

  it('warns and omits malformed local and far terrain instead of substituting fake heights', async () => {
    const f = fixture()
    f.terrain.zM = [0]
    f.docs['/data/Site01/terrain-far.json'] = { ...f.terrain, frame: 'wrong axes' }
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain).toBeUndefined()
    expect(data.terrainFar).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/invalid zM/)
    expect(data.visualWarnings?.join(' ')).toMatch(/invalid frame/)
    expect(data.horizon.elevDeg).toEqual([1, 2, 3, 4])
  })

  it('distinguishes optional network errors from expected far-mesh HTTP 404', async () => {
    const f = fixture()
    mockFiles(f.docs, { '/data/Site01/terrain-far.json': new Error('connection lost') })
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain).toBeDefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/terrain-far.json: network request failed.*connection lost/)
  })

  it('reports missing registered Earth orientation without disabling calculations', async () => {
    const f = fixture()
    delete f.docs['/data/Site01/earth-orientation.json']
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.earthOrientation).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/registered Earth texture orientation unavailable/)
    expect(data.ephemeris).toEqual(f.ephemeris)
  })

  it('accepts an independently sampled hourly visual grid covering the scientific period', async () => {
    const f = fixture()
    f.orientation.stepS = 3600
    f.orientation.count = 2
    f.orientation.quaternionXyzw = f.orientation.quaternionXyzw.slice(0, 2)
    f.orientation.sunDirectionAtEarth = f.orientation.sunDirectionAtEarth.slice(0, 2)
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.earthOrientation).toEqual(f.orientation)
    expect(data.ephemeris.stepS).toBe(600)
    expect(data.visualWarnings).toEqual([])
  })

  it.each(['tooSparse', 'notMultiple', 'startsLate', 'endsEarly', 'unaligned'])('omits an unusable visual coverage grid: %s', async (kind) => {
    const f = fixture()
    if (kind === 'tooSparse') f.orientation.stepS = 7200
    if (kind === 'notMultiple') f.orientation.stepS = 900
    if (kind === 'startsLate') f.orientation.startUtc = '2026-11-01T00:10:00Z'
    if (kind === 'endsEarly') {
      f.orientation.count = 2
      f.orientation.quaternionXyzw.pop()
      f.orientation.sunDirectionAtEarth.pop()
    }
    if (kind === 'unaligned') {
      f.orientation.startUtc = '2026-10-31T23:55:00Z'
      f.orientation.stepS = 3600
    }
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.earthOrientation).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/invalid time grid/)
  })

  it.each(['badQuaternion', 'wrongGrid', 'badSunVector', 'wrongTextureFrame'])('omits invalid Earth orientation: %s', async (kind) => {
    const f = fixture()
    if (kind === 'badQuaternion') f.orientation.quaternionXyzw[0] = [0, 0, 0, 2]
    if (kind === 'wrongGrid') f.orientation.stepS = 60
    if (kind === 'badSunVector') f.orientation.sunDirectionAtEarth[0] = [0, 0, 0]
    if (kind === 'wrongTextureFrame') f.orientation.source.textureBodyFrame = 'unregistered'
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.earthOrientation).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/earth-orientation.json: invalid/)
    expect(data.horizon).toEqual(f.horizon)
  })
})

describe('required scientific data is rejected clearly', () => {
  it('preserves the missing-catalogue HTTP error including its supplied base path', async () => {
    mockFiles({})
    await expect(loadAllData('data')).rejects.toThrow('data/sites.json: HTTP 404')
  })

  it('preserves the missing-horizon HTTP error including its supplied base path', async () => {
    const f = fixture()
    delete f.docs['/data/Site01/horizon.json']
    mockFiles(f.docs)
    await expect(loadAllData('/data')).rejects.toThrow('/data/Site01/horizon.json: HTTP 404')
  })

  it('requests each catalogue/science/visual file exactly once under a relative base', async () => {
    const f = fixture()
    const docs = Object.fromEntries(Object.entries(f.docs).map(([key, value]) => [key.slice(1), value]))
    const fetch = mockFiles(docs)
    const loaded = await loadAllData('data')
    expect(Object.keys(loaded.bySite)).toEqual(['Site01'])
    const urls = fetch.mock.calls.map(([url]) => String(url))
    expect(urls).toHaveLength(11)
    expect(new Set(urls).size).toBe(11)
    expect(urls.every(url => url.startsWith('data/'))).toBe(true)
  })

  it('rejects a missing ephemeris rather than creating a dark zero series', async () => {
    const f = fixture()
    mockFiles(f.docs, { '/data/Site01/ephemeris.json': 404 })
    await expect(loadAllData('/data')).rejects.toThrow('/data/Site01/ephemeris.json: HTTP 404')
  })

  it('reports the URL on a required network failure', async () => {
    const f = fixture()
    mockFiles(f.docs, { '/data/Site01/horizon.json': new Error('offline') })
    await expect(loadAllData('/data')).rejects.toThrow('/data/Site01/horizon.json: network request failed (offline)')
  })

  it.each(['version', 'siteId', 'count', 'nonFinite', 'azimuth', 'elevation', 'distance', 'frame', 'height', 'grid', 'synthetic'])('rejects invalid ephemeris %s', async (kind) => {
    const f = fixture()
    if (kind === 'version') f.ephemeris.version = 2
    if (kind === 'siteId') f.ephemeris.siteId = 'Site04'
    if (kind === 'count') f.ephemeris.sun.azDeg.pop()
    if (kind === 'nonFinite') f.ephemeris.sun.elDeg[1] = NaN
    if (kind === 'azimuth') f.ephemeris.sun.azDeg[1] = 360
    if (kind === 'elevation') f.ephemeris.sun.elDeg[1] = 91
    if (kind === 'distance') f.ephemeris.sun.distanceM[1] = 0
    if (kind === 'frame') f.ephemeris.settings.frame = 'IAU_MOON'
    if (kind === 'height') f.ephemeris.settings.observerHeightM = 10
    if (kind === 'grid') f.ephemeris.stepS = 60
    if (kind === 'synthetic') f.ephemeris.source = 'synthetic'
    mockFiles(f.docs)
    await expect(loadAllData('/data')).rejects.toThrow(/ephemeris.json: invalid/)
  })

  it.each(['empty', 'angularGrid', 'nonFinite', 'siteId', 'curvature'])('rejects invalid horizon %s', async (kind) => {
    const f = fixture()
    if (kind === 'empty') f.horizon.elevDeg = []
    if (kind === 'angularGrid') f.horizon.azStepDeg = 1
    if (kind === 'nonFinite') f.horizon.elevDeg[2] = Infinity
    if (kind === 'siteId') f.horizon.siteId = 'Site04'
    if (kind === 'curvature') f.horizon.params.curvature = false
    mockFiles(f.docs)
    await expect(loadAllData('/data')).rejects.toThrow(/horizon.json: invalid/)
  })

  it.each(['version', 'duplicate', 'path', 'noUTC', 'calendar'])('rejects invalid catalogue %s', async (kind) => {
    const f = fixture()
    if (kind === 'version') f.sites.version = 2
    if (kind === 'duplicate') f.sites.sites.push(structuredClone(f.sites.sites[0]))
    if (kind === 'path') f.sites.sites[0].id = '../Site04'
    if (kind === 'noUTC') f.sites.coverage.startUtc = '2026-11-01T00:00:00'
    if (kind === 'calendar') f.sites.coverage.startUtc = '2026-02-30T00:00:00Z'
    mockFiles(f.docs)
    await expect(loadAllData('/data')).rejects.toThrow(/sites.json: invalid/)
  })
})

it('loads the published scientific datasets without changing their values (local mock, no network)', async () => {
  const directory = fileURLToPath(new URL('../../public/data/', import.meta.url))
  const catalogue = JSON.parse(readFileSync(`${directory}sites.json`, 'utf8'))
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const path = `${directory}${String(input).replace(/^\/data\//, '')}`
    const exists = existsSync(path)
    return { ok: exists, status: exists ? 200 : 404, json: async () => JSON.parse(readFileSync(path, 'utf8')) } as Response
  }))
  const loaded = await loadAllData('/data')
  expect(Object.keys(loaded.bySite)).toEqual(catalogue.sites.map((s: { id: string }) => s.id))
  for (const { id } of catalogue.sites) {
    expect(loaded.bySite[id].ephemeris).toEqual(JSON.parse(readFileSync(`${directory}${id}/ephemeris.json`, 'utf8')))
    expect(loaded.bySite[id].horizon).toEqual(JSON.parse(readFileSync(`${directory}${id}/horizon.json`, 'utf8')))
    expect(loaded.bySite[id].terrain).toBeDefined()
    if (existsSync(`${directory}${id}/terrain-far.json`)) expect(loaded.bySite[id].terrainFar).toBeDefined()
    if (existsSync(`${directory}${id}/earth-orientation.json`)) expect(loaded.bySite[id].earthOrientation).toBeDefined()
    expect(loaded.bySite[id].season).toEqual(JSON.parse(readFileSync(`${directory}${id}/season.json`, 'utf8')))
    if (existsSync(`${directory}${id}/map.json`)) expect(loaded.bySite[id].map).toEqual(JSON.parse(readFileSync(`${directory}${id}/map.json`, 'utf8')))
  }
})


describe('measured surface display extension', () => {
  const detail = (f: ReturnType<typeof fixture>) => ({
    version: 1, siteId: f.id, file: 'terrain-normal.png', sizeM: f.terrain.sizeM, n: 16,
    frame: 'Three object normal (+east,+up,-north)', sourceNativePixelM: 1,
    outputPixelM: f.terrain.sizeM / 16, sha256: 'a'.repeat(64),
    source: { url: 'NASA source', sha256: 'b'.repeat(64), method: 'Measured DEM gradients',
      site: { latitudeDeg: f.sites.sites[0].latDeg, longitudeDeg: f.sites.sites[0].lonDeg,
        surfaceElevationM: f.sites.sites[0].surfaceElevationM, observerHeightM: 2 } },
  })
  it('attaches registered local normals without changing elevations or scientific data', async () => {
    const f = fixture()
    // Fixture is a 20 m patch, so the synthetic plane's 1 m source is not oversampled.
    f.docs['/data/Site01/terrain-normal.json'] = detail(f)
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain?.zM).toEqual(f.terrain.zM)
    expect(data.terrain?.normalDetail?.textureUrl).toBe('/data/Site01/terrain-normal.png?v=' + 'a'.repeat(64))
    expect(data.ephemeris).toEqual(f.ephemeris)
  })
  it('keeps a smaller, centred native footprint separate from the mesh footprint', async () => {
    const f = fixture()
    const manifest = detail(f)
    manifest.sizeM = 10
    manifest.sourceNativePixelM = 0.5
    manifest.outputPixelM = 10 / 16
    f.docs['/data/Site01/terrain-normal.json'] = manifest
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain?.sizeM).toBe(20)
    expect(data.terrain?.normalDetail?.manifest.sizeM).toBe(10)
    expect(data.terrain?.zM).toEqual(f.terrain.zM)
  })
  it.each(['coordinate', 'path', 'frame', 'spacing'])('omits unsafe or stale measured normals: %s', async kind => {
    const f = fixture()
    const manifest = detail(f)
    if (kind === 'coordinate') manifest.source.site.longitudeDeg += 1
    if (kind === 'path') manifest.file = '../other.png'
    if (kind === 'frame') manifest.frame = 'unregistered'
    if (kind === 'spacing') manifest.outputPixelM = 0
    f.docs['/data/Site01/terrain-normal.json'] = manifest
    mockFiles(f.docs)
    const data = (await loadAllData('/data')).bySite.Site01
    expect(data.terrain?.normalDetail).toBeUndefined()
    expect(data.visualWarnings?.join(' ')).toMatch(/invalid terrain normal/)
    expect(data.horizon).toEqual(f.horizon)
  })
})
