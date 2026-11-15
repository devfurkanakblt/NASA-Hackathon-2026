/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoverageDoc, MapDoc, SiteData } from './contract.ts'
import { pointCoverage, validateCoverage } from './coverage.ts'
import { loadAllData } from './load.ts'

const RAD = Math.PI / 180
const R = 1_737_400
const SP = 100
const HALF = 300

/** 7x7 map of 100 m cells around a centre, via the small-angle local tangent plane. */
function mapAt(siteId: string, lat0: number, lon0: number): MapDoc {
  const n = 2 * HALF / SP + 1
  const latDeg: number[] = [], lonDeg: number[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const north = -HALF + r * SP, east = -HALF + c * SP
    latDeg.push(lat0 + north / R / RAD)
    lonDeg.push(lon0 + east / (R * Math.cos(lat0 * RAD)) / RAD)
  }
  return { grid: { nx: n, ny: n, spacingM: SP, halfSizeM: HALF }, latDeg, lonDeg, siteId } as unknown as MapDoc
}

const T = { startUtc: '2026-11-01T00:00:00Z', endUtc: '2027-11-01T00:00:00Z', stepS: 600, mainPeriodEndUtc: '2027-01-01T00:00:00Z' }
const cov: CoverageDoc = {
  version: 1, time: T,
  catalogue: [{ siteId: 'S1', latDeg: -80, lonDeg: 179.9995, horizonResolutionDeg: 0.1 }, { siteId: 'S2', latDeg: -80, lonDeg: 10, horizonResolutionDeg: 0.1 }],
  maps: [{ siteId: 'S1', halfSizeM: HALF, spacingM: SP, horizonResolutionDeg: 1, summaryResolutionDeg: 0.5, summaryPeriod: [T.startUtc, T.mainPeriodEndUtc] }],
  dems: [{ name: 'LDEM_64', kind: 'global-474m' }], freePoints: 'x',
}
// Map centred exactly on the antimeridian so cells exist on both sides.
const bySite = { S1: { map: mapAt('S1', -80, 180) } } as unknown as Record<string, SiteData>

describe('pointCoverage', () => {
  it('snapped point reports the snapped coordinate and distance', () => {
    const p = pointCoverage(-80.00033, 179.99, cov, bySite)
    expect(p.kind).toBe('map-cell')
    expect(p.siteId).toBe('S1')
    expect(p.distanceM!).toBeLessThanOrEqual(SP)
    expect(p.snappedLatDeg).toBeDefined()
    expect(p.snappedLonDeg).toBeDefined()
  })

  it('180° and −180° snap to the same cell', () => {
    const a = pointCoverage(-80, 180, cov, bySite)
    const b = pointCoverage(-80, -180, cov, bySite)
    expect(a).toEqual(b)
    expect(a.kind).toBe('map-cell')
    expect(pointCoverage(-80, 540, cov, bySite)).toEqual(a)
  })

  it('a catalogue coordinate is reported as the catalogue site', () => {
    expect(pointCoverage(-80, 10, cov, bySite)).toMatchObject({ kind: 'catalogue', siteId: 'S2' })
  })

  it('a point 10 km from every map is outside and names the nearest map with its distance', () => {
    const p = pointCoverage(-80 + 10_000 / R / RAD + HALF / R / RAD, 180, cov, bySite)
    expect(p.kind).toBe('outside')
    expect(p.siteId).toBe('S1')
    expect(p.distanceM!).toBeGreaterThan(9_900)
    expect(p.message).toContain('S1')
    expect(p.message).toMatch(/10\.\d km/)
  })

  it('rejects invalid input without a nearest-map claim', () => {
    expect(pointCoverage(-91, 0, cov, bySite).kind).toBe('outside')
    expect(pointCoverage(NaN, 0, cov, bySite).kind).toBe('outside')
  })
})

describe('validateCoverage', () => {
  it('accepts a valid document and rejects a broken time range', () => {
    expect(validateCoverage(cov)).toEqual(cov)
    expect(() => validateCoverage({ ...cov, time: { ...T, mainPeriodEndUtc: '2028-01-01T00:00:00Z' } })).toThrow(/time/)
    expect(() => validateCoverage({ ...cov, version: 2 })).toThrow(/version/)
  })
})

describe('loadAllData with coverage.json', () => {
  afterEach(() => vi.unstubAllGlobals())

  function files(extra: Record<string, unknown>) {
    const startUtc = '2026-11-01T00:00:00Z'
    const site = { id: 'Site01', name: 'x', latDeg: -89, lonDeg: 12, surfaceElevationM: 100, observerHeightM: 2, coordSource: 'n', demNear: 'a', demFar: 'b', label: 'l', warnings: [] }
    const body = { azDeg: [359.9, 0, 0.1], elDeg: [-1, 0, 1], distanceM: [1e11, 1e11, 1e11] }
    return {
      '/data/sites.json': { version: 1, coverage: { startUtc, endUtc: '2026-11-01T00:20:00Z', stepS: 600 }, sites: [site] },
      '/data/Site01/ephemeris.json': { version: 1, siteId: 'Site01', source: 'jpl-horizons', generatedUtc: startUtc,
        settings: { center: 'coord@301', frame: 'MOON_ME', refraction: false, observerHeightM: 2 }, startUtc, stepS: 600, count: 3, sun: body, earth: body },
      '/data/Site01/horizon.json': { version: 1, siteId: 'Site01', azStepDeg: 90, count: 4, elevDeg: [1, 2, 3, 4], distanceM: [1, 2, 3, 4],
        params: { nearRangeM: 7000, nearStepM: 2.5, maxRangeM: 250000, farStepM: 40, minRangeM: 10, curvature: true }, warnings: [] },
      ...extra,
    } as Record<string, unknown>
  }
  const mock = (docs: Record<string, unknown>) => vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const ok = Object.hasOwn(docs, url)
    return { ok, status: ok ? 200 : 404, json: async () => structuredClone(docs[url]) } as Response
  }))

  it('missing coverage.json does not break loadAllData', async () => {
    mock(files({}))
    const data = await loadAllData('/data')
    expect(data.coverage).toBeUndefined()
    expect(data.bySite.Site01.horizon.count).toBe(4)
  })

  it('loads a valid coverage.json and ignores an invalid one', async () => {
    mock(files({ '/data/coverage.json': cov }))
    expect((await loadAllData('/data')).coverage).toEqual(cov)
    mock(files({ '/data/coverage.json': { version: 9 } }))
    const data = await loadAllData('/data')
    expect(data.coverage).toBeUndefined()
    expect(data.bySite.Site01).toBeDefined()
  })
})
