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
    label: 'Not a certified landing site', warnings: [] }
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
    expect(fetch).toHaveBeenCalledTimes(6)
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
    expect(urls).toHaveLength(6)
    expect(new Set(urls).size).toBe(6)
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
  }
})
