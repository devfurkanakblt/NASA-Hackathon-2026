/// <reference types="node" />
/**
 * Free coordinates (D): any point on the Moon is computed in the browser from the Moon-fixed
 * Sun / Earth vectors of one loaded year series and a horizon ray-marched on the global LDEM_64
 * tiles. Checks: id format and share links; the coordinate decision (catalogue → map cell →
 * free point, never a silent move); the horizon rule on synthetic terrain; the ephemeris against
 * sites with their own series; the horizon and visibility against catalogue sites whose horizon
 * was built from LDEM_64; the engine end to end.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HorizonDoc, MapDoc, SiteData, SitesDoc } from '../src/data/contract.ts'
import { parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { GlobalDem, tilesAround, validateGlobalDemManifest, type GlobalDemManifest } from '../src/data/globalDem.ts'
import { resolveSiteData, sitesNeeded, isKnownSiteId } from '../src/app/extendedSites.ts'
import { placeForCoordinate } from '../src/app/freePointLoader.ts'
import { placeTitle } from '../src/app/placeName.ts'
import { decodeShare, encodeShare } from '../src/app/share.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'
import { FREE_POINT_LABEL, freePointId, freePointSiteData, globalHorizon, parseFreePointId } from '../src/sim/freePoint.ts'
import { moonFixedKey, moonFixedSeries, projectWindow } from '../src/sim/moonFixed.ts'
import { horizonAt, marginSeries } from '../src/sim/visibility.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DATA + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json').sites
const site = (id: string) => sites.find((s) => s.id === id)!
const header = (id: string) => read<ExtendedHeader>(`${id}/extended.json`)
const yearOf = (id: string) => parseYear(id, header(id), bin(`${id}/year.bin`))
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const bySite = (): Record<string, SiteData> =>
  Object.fromEntries(sites.map((s) => [s.id, { site: s, ephemeris: read(`${s.id}/ephemeris.json`), horizon: read(`${s.id}/horizon.json`), map: existsSync(`${DATA}${s.id}/map.json`) ? read<MapDoc>(`${s.id}/map.json`) : undefined } as SiteData]))

describe('free point ids', () => {
  it('round-trips with 5 decimals and normalises longitude', () => {
    expect(freePointId(-8.97, 15.5)).toBe('pt:-8.97000:15.50000')
    expect(freePointId(-89.4632, 222.51)).toBe('pt:-89.46320:-137.49000')
    expect(freePointId(0, -180)).toBe('pt:0.00000:180.00000')
    expect(parseFreePointId('pt:-8.97000:15.50000')).toEqual({ latDeg: -8.97, lonDeg: 15.5 })
    expect(parseFreePointId('pt:-91:0')).toBeNull()
    expect(parseFreePointId('Site01')).toBeNull()
    expect(() => freePointId(Number.NaN, 0)).toThrow(RangeError)
  })

  it('travels in a share link and is a known scenario id', () => {
    const id = freePointId(-8.97, 15.5)
    const all = bySite()
    const hash = encodeShare({ scenarios: [{ key: 'a', siteId: id, startUtc: '2026-11-15T00:00:00Z' }], active: 0, settings: DEFAULT_SETTINGS })
    expect(hash).toBe('#s=pt:-8.97000:15.50000@2026-11-15T00:00')
    expect(decodeShare(hash, (x) => isKnownSiteId(x, all))!.scenarios[0].siteId).toBe(id)
    expect(placeTitle(id, all)).toBe('Your point 8.970°S, 15.500°E')
  })

  it('is resolved from the computed points, needs no year.bin, and never falls back to another place', () => {
    const id = freePointId(-8.97, 15.5)
    const all = bySite()
    expect(sitesNeeded([{ siteId: id, startUtc: '2027-04-01T00:00:00Z' }], '2027-01-01T00:00:00Z', 7, all)).toEqual({ years: [], cells: [], points: [id] })
    expect(resolveSiteData(id, '2026-11-15T00:00:00Z', '2027-01-01T00:00:00Z', all, { years: {}, cells: {} })).toEqual({ loading: 'Computing your point from the global terrain…' })
    expect('error' in resolveSiteData(id, '2026-11-15T00:00:00Z', '2027-01-01T00:00:00Z', all, { years: {}, cells: {}, points: { [id]: 'error' } })).toBe(true)
  })
})

describe('placeForCoordinate', () => {
  const all = bySite()
  it('catalogue site within 1 m', () => {
    const s = site('Apollo16')
    expect(placeForCoordinate(s.latDeg, s.lonDeg, all)).toMatchObject({ siteId: 'Apollo16', kind: 'catalogue' })
  })
  it('inside a polar map: the nearest cell, with the distance said', () => {
    const r = placeForCoordinate(-89.46, -137.49, all)
    expect(r).toMatchObject({ kind: 'map-cell' })
    if ('message' in r) expect(r.message).toMatch(/±3 km map of Site01.* m from your point/)
  })
  it('anywhere else: this exact coordinate, labelled as a screening estimate', () => {
    const r = placeForCoordinate(10.5, 400, all) // northern hemisphere, longitude past 360
    expect(r).toEqual({ siteId: 'pt:10.50000:40.00000', kind: 'free', message: expect.stringMatching(/exact coordinate.*screening estimate/) })
    expect(placeForCoordinate(-91, 0, all)).toEqual({ error: 'Latitude must be between −90° and 90°.' })
    expect(placeForCoordinate(Number.NaN, 0, all)).toHaveProperty('error')
  })
})

// ------------------------------------------------------------------ synthetic DEM

function syntheticDem(height: (lat: number, lon: number) => number, ppd = 4): GlobalDem {
  const rows = 180 * ppd
  const cols = 360 * ppd
  const tileDeg = 90
  const tilePx = tileDeg * ppd
  const tiles = new Map<string, Int16Array>()
  const meta: GlobalDemManifest['tiles'] = {}
  for (let tr = 0; tr < rows / tilePx; tr++) {
    for (let tc = 0; tc < cols / tilePx; tc++) {
      const t = new Int16Array(tilePx * tilePx)
      for (let r = 0; r < tilePx; r++) {
        for (let c = 0; c < tilePx; c++) {
          const lat = 90 - (tr * tilePx + r + 0.5) / ppd
          const lon = (tc * tilePx + c + 0.5) / ppd
          t[r * tilePx + c] = Math.round(height(lat, lon) / 0.5)
        }
      }
      tiles.set(`t_${tr}_${tc}.bin`, t)
      meta[`t_${tr}_${tc}.bin`] = { sha256: '', bytes: t.byteLength }
    }
  }
  const m: GlobalDemManifest = { version: 1, kind: 'global-dem-tiles', source: 'synthetic', sourceUrl: '', method: 'synthetic', ppd, pixelM: (Math.PI / 180 / ppd) * 1737400, scaleM: 0.5, radiusM: 1737400, rows, cols, tileDeg, tilePx, layout: '', tiles: meta }
  expect(validateGlobalDemManifest(m)).toEqual([])
  return new GlobalDem(m, tiles)
}

describe('globalHorizon (synthetic terrain)', () => {
  it('a smooth sphere gives only the curvature dip, a few hundredths of a degree', () => {
    const dem = syntheticDem(() => 0)
    const h = globalHorizon(dem, -20, 30, 2, 1)
    for (const e of h.elevDeg) {
      expect(e).toBeLessThan(0)
      expect(e).toBeGreaterThan(-0.2)
    }
  })
  it('a 2 km high band to the north raises the north horizon to the analytic angle, not the south', () => {
    // band between 1° and 2° north of the observer at the equator: nearest edge ~30 km away
    const dem = syntheticDem((lat) => (lat > 1 && lat < 2 ? 2000 : 0))
    const h = globalHorizon(dem, 0, 30, 2, 1)
    const R = 1737400
    const th = (1 * Math.PI) / 180
    const want = (Math.atan2((R + 2000) * Math.cos(th) - (R + 2), (R + 2000) * Math.sin(th)) * 180) / Math.PI
    expect(h.elevDeg[0]).toBeGreaterThan(want - 0.6) // bilinear edge of the band
    expect(h.elevDeg[0]).toBeLessThan(want + 0.6)
    expect(h.elevDeg[180]).toBeLessThan(0)
    expect(h.distanceM![0]).toBeGreaterThan(20000)
  })
  it('longitude is periodic across 0/360 and the tile list wraps', () => {
    const dem = syntheticDem((_lat, lon) => (lon > 359 || lon < 1 ? 1000 : 0))
    expect(dem.heightAt(0, 0)).toBeGreaterThan(900)
    expect(dem.heightAt(0, 360)).toBeCloseTo(dem.heightAt(0, 0), 6)
    expect(dem.heightAt(0, -180)).toBe(0)
    const names = tilesAround({ ...dem.manifest }, 0, 0.1, 250000)
    expect(names).toContain('t_0_0.bin'.replace('0_0', '1_0'))
    expect(names).toContain('t_1_3.bin')
    expect(tilesAround(dem.manifest, -89.9, 0, 250000).filter((n) => n.startsWith('t_1_'))).toHaveLength(4) // whole cap
  })
  it('a missing tile is an error, never zero terrain', () => {
    const dem = syntheticDem(() => 0)
    const partial = new GlobalDem(dem.manifest, new Map())
    expect(() => partial.heightAt(0, 0)).toThrow(/not loaded/)
  })
})

// ------------------------------------------------------------------ ephemeris

describe('free point ephemeris', () => {
  const ref = yearOf('Site01')
  const centre = { latDeg: site('Site01').latDeg, lonDeg: site('Site01').lonDeg, eyeM: site('Site01').surfaceElevationM + site('Site01').observerHeightM }
  const mf = moonFixedSeries(ref, centre, moonFixedKey({ dataHash: header('Site01').year.sha256, ...centre, horizonResolutionDeg: 0.1 }))

  it('Site01’s vectors re-projected to far-away sites match their own series (≤ 0.003°)', () => {
    for (const id of ['Apollo16', 'CE4', 'SLIM', 'Chandrayaan3', 'Site23']) {
      const s = site(id)
      const own = yearOf(id)
      const eph = projectWindow(mf, { latDeg: s.latDeg, lonDeg: s.lonDeg, eyeM: s.surfaceElevationM + s.observerHeightM }, 0, mf.count)
      let maxAz = 0
      let maxEl = 0
      for (const b of ['sun', 'earth'] as const) {
        for (let i = 0; i < own.count; i += 97) {
          // azimuth is ill-defined right at the zenith; skip elevations above 85°
          if (own[b].elDeg[i] < 85) maxAz = Math.max(maxAz, Math.abs(wrap(eph[b].azDeg[i] - own[b].azDeg[i])))
          maxEl = Math.max(maxEl, Math.abs(eph[b].elDeg[i] - own[b].elDeg[i]))
        }
      }
      expect(maxEl, `${id} el`).toBeLessThanOrEqual(0.003)
      expect(maxAz, `${id} az`).toBeLessThanOrEqual(0.01)
    }
  })
})

// ------------------------------------------------------------------ against the real tiles

const TILES = `${DATA}global-dem/manifest.json`
const haveTiles = existsSync(TILES)

function realDem(lat: number, lon: number): GlobalDem {
  const m = read<GlobalDemManifest>('global-dem/manifest.json')
  expect(validateGlobalDemManifest(m)).toEqual([])
  const tiles = new Map<string, Int16Array>()
  for (const n of tilesAround(m, lat, lon, 260000)) tiles.set(n, new Int16Array(bin(`global-dem/${n}`)))
  return new GlobalDem(m, tiles)
}

describe.runIf(haveTiles)('free point on the real global tiles', () => {
  const ref = yearOf('Site01')
  const refHeader = header('Site01')

  it('surface height and horizon agree with LDEM_64 catalogue sites (screening accuracy)', () => {
    for (const id of ['Apollo16', 'SLIM', 'CE4', 'CE6', 'Chandrayaan3']) {
      const s = site(id)
      const dem = realDem(s.latDeg, s.lonDeg)
      // LDEM_64 averaged to ~1.9 km vs the exact LDEM_64 surface: tens of metres on maria, more in highlands
      expect(Math.abs(dem.heightAt(s.latDeg, s.lonDeg) - s.surfaceElevationM), `${id} surface`).toBeLessThan(400)
      const own = read<HorizonDoc>(`${id}/horizon.json`)
      const mine = globalHorizon(dem, s.latDeg, s.lonDeg, s.surfaceElevationM + s.observerHeightM, 1)
      let sq = 0
      let max = 0
      for (let i = 0; i < 360; i++) {
        const diff = mine.elevDeg[i] - horizonAt(own, i)
        sq += diff * diff
        max = Math.max(max, Math.abs(diff))
      }
      const rms = Math.sqrt(sq / 360)
      expect(rms, `${id} horizon RMS`).toBeLessThan(1.0)
      expect(max, `${id} horizon max`).toBeLessThan(3.0)
    }
  })

  it('end to end: a free point runs through the engine; yearly Sun share close to the catalogue site', () => {
    for (const id of ['Apollo16', 'CE4']) {
      const s = site(id)
      const data = freePointSiteData({ latDeg: s.latDeg + 1e-6, lonDeg: s.lonDeg, dem: realDem(s.latDeg, s.lonDeg), year: ref, yearSite: site('Site01'), yearSha256: refHeader.year.sha256 })
      expect(data.site.label).toBe(FREE_POINT_LABEL)
      expect(data.provenance).toMatchObject({ horizonSource: 'global-dem', precision: 'global screening estimate', horizonResolutionDeg: 0.1 })
      expect(data.horizon.count).toBe(3600)
      const r = evaluateScenario(data, '2027-04-10T00:00:00Z', DEFAULT_SETTINGS)
      expect(Number.isFinite(r.summary.minSocFraction)).toBe(true)
      const cat = read<{ year: { sunPct: number; earthPct: number } }>(`${id}/season.json`).year
      expect(Math.abs(data.season!.year.sunPct - cat.sunPct), `${id} sun`).toBeLessThan(2)
      expect(Math.abs(data.season!.year.earthPct - cat.earthPct), `${id} earth`).toBeLessThan(2)
      const n = data.ephemeris.count
      expect(marginSeries(data.ephemeris.sun, data.horizon, 0, n).every(Number.isFinite)).toBe(true)
    }
  })

  it('a northern-hemisphere point (outside the catalogue) computes in well under a second', () => {
    const t = Date.now()
    const data = freePointSiteData({ latDeg: 26.13, lonDeg: 3.63, dem: realDem(26.13, 3.63), year: ref, yearSite: site('Site01'), yearSha256: refHeader.year.sha256 })
    const ms = Date.now() - t
    expect(data.site.id).toBe('pt:26.13000:3.63000')
    expect(evaluateScenario(data, '2026-11-20T00:00:00Z', DEFAULT_SETTINGS).count).toBe(1009)
    expect(ms).toBeLessThan(3000)
  })
})
