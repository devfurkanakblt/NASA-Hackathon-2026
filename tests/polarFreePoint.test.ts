/// <reference types="node" />
/**
 * Free coordinates on the south-polar 80 m DEM (D): the browser tiles decode to the same heights the
 * Python pipeline reads from LDEM_80S_80MPP_ADJ, and the browser horizon agrees with the catalogue
 * horizons that the pipeline built from that DEM (`regional80` points).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HorizonDoc, SeasonDoc, SitesDoc } from '../src/data/contract.ts'
import { parseYear, type ExtendedHeader } from '../src/data/extended.ts'
import { GlobalDem, tilesAround, type GlobalDemManifest } from '../src/data/globalDem.ts'
import { PolarDem, decodePolarFile, nearTilesAround, polarXY, undelta, validatePolarDemManifest, type PolarDemManifest } from '../src/data/polarDem.ts'
import { FREE_POINT_POLAR_LABEL, POLAR_NEAR_RANGE_M, freePointSiteData, polarHorizon } from '../src/sim/freePoint.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../src/sim/evaluate.ts'
import { precisionOf } from '../src/sim/search.ts'
import { horizonAt } from '../src/sim/visibility.ts'

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DATA + p, 'utf8')) as T
const bin = (p: string) => {
  const b = readFileSync(DATA + p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const sites = read<SitesDoc>('sites.json').sites
const site = (id: string) => sites.find((s) => s.id === id)!
const pm = read<PolarDemManifest>('polar-dem/manifest.json')

async function polarAround(lat: number, lon: number): Promise<PolarDem> {
  const t = pm.near.tilePx
  const names = nearTilesAround(pm, lat, lon, POLAR_NEAR_RANGE_M)
  const tiles = await Promise.all(names.map((n) => decodePolarFile(pm, n, bin(`polar-dem/${n}`), t, t)))
  const far = await decodePolarFile(pm, pm.far.file, bin(`polar-dem/${pm.far.file}`), pm.far.cols, pm.far.rows)
  return new PolarDem(pm, new Map(names.map((n, i) => [n, tiles[i]])), far)
}
function globalAround(lat: number, lon: number): GlobalDem {
  const m = read<GlobalDemManifest>('global-dem/manifest.json')
  const tiles = new Map<string, Int16Array>()
  for (const n of tilesAround(m, lat, lon, 260000)) tiles.set(n, new Int16Array(bin(`global-dem/${n}`)))
  return new GlobalDem(m, tiles)
}

describe('polar DEM tiles', () => {
  it('manifest, projection and delta decoding', () => {
    expect(validatePolarDemManifest(pm)).toEqual([])
    // pyproj (+proj=stere +lat_0=-90 +lat_ts=-90 +R=1737400): (lon 0, lat -85) → (0, 151713.04)
    const [x, y] = polarXY(pm, -85, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(151713.0444, 3)
    const [x2] = polarXY(pm, -85.42088, 31.6218)
    expect(x2).toBeCloseTo(72841.444, 2)
    expect(Array.from(undelta(Int16Array.from([5, 2, -3, 10, 0, 1]), 3))).toEqual([5, 7, 4, 10, 10, 11])
  })

  it('decoded heights equal the Python reader of LDEM_80S_80MPP_ADJ (bilinear, 0.5 m quantum)', async () => {
    // preprocess.dem.Dem.sample on the source GeoTIFF
    const want: [string, number, number, number][] = [
      ['Site01', -89.4632, -137.49, 1943.32],
      ['VIPER', -85.42088, 31.6218, 6416.34],
      ['IM1', -80.13, 1.44, 2591.95],
      ['Haworth', -86.768, -20.514, 1903.95],
      ['edge', -80.3, 45.0, 821.62],
    ]
    for (const [name, lat, lon, h] of want) {
      const dem = await polarAround(lat, lon)
      const [x, y] = polarXY(pm, lat, lon)
      expect(Math.abs(dem.nearAt(x, y) - h), name).toBeLessThanOrEqual(0.5)
    }
  })

  it('refuses a changed file', async () => {
    const n = 'far.bin.gz'
    const b = new Uint8Array(bin(`polar-dem/${n}`).slice(0))
    b[100] ^= 1
    await expect(decodePolarFile(pm, n, b.buffer, pm.far.cols, pm.far.rows)).rejects.toThrow(/sha256/)
  })
})

describe('free point on the polar DEM vs the regional80 catalogue horizons', () => {
  const REGIONAL80 = ['IM1', 'IM2', 'ArtemisCabeusB', 'ArtemisHaworth', 'ArtemisMoutonPlateau', 'ArtemisNobile1', 'ArtemisNobile2', 'ArtemisGerlache2', 'ArtemisSlater']
  it('horizon RMS within 0.3°, every catalogue site on the 80 m grid', async () => {
    const rows: string[] = []
    for (const id of REGIONAL80) {
      const s = site(id)
      const polar = await polarAround(s.latDeg, s.lonDeg)
      expect(polar.covers(s.latDeg, s.lonDeg), id).toBe(true)
      const own = read<HorizonDoc>(`${id}/horizon.json`)
      const mine = polarHorizon(polar, globalAround(s.latDeg, s.lonDeg), s.latDeg, s.lonDeg, s.surfaceElevationM + s.observerHeightM, 1)
      let sq = 0
      let max = 0
      for (let i = 0; i < 360; i++) {
        const d = mine.elevDeg[i] - horizonAt(own, i)
        sq += d * d
        max = Math.max(max, Math.abs(d))
      }
      const rms = Math.sqrt(sq / 360)
      rows.push(`${id} ${rms.toFixed(3)} ${max.toFixed(3)}`)
      expect(rms, id).toBeLessThan(0.3)
      expect(max, id).toBeLessThan(1.5)
    }
  }, 120000)

  it('end to end: a polar free point gets the 80 m horizon, a 3D patch and yearly shares close to the catalogue', async () => {
    const header = read<ExtendedHeader>('Site01/extended.json')
    const year = parseYear('Site01', header, bin('Site01/year.bin'))
    for (const id of ['IM2', 'ArtemisHaworth']) {
      const s = site(id)
      const polar = await polarAround(s.latDeg, s.lonDeg)
      const t0 = Date.now()
      const d = freePointSiteData({ latDeg: s.latDeg, lonDeg: s.lonDeg, dem: globalAround(s.latDeg, s.lonDeg), polar, year, yearSite: site('Site01'), yearSha256: header.year.sha256 })
      const ms = Date.now() - t0
      expect(d.site.label).toBe(FREE_POINT_POLAR_LABEL)
      expect(d.provenance).toMatchObject({ horizonSource: 'regional-dem', precision: 'regional screening estimate' })
      expect(precisionOf(d, 'catalogue')).toEqual({ precision: 'free', label: FREE_POINT_POLAR_LABEL })
      expect(d.terrain).toMatchObject({ n: 128, sizeM: 10000 })
      expect(Math.abs(d.site.surfaceElevationM - s.surfaceElevationM), `${id} surface`).toBeLessThan(1)
      const cat = read<SeasonDoc>(`${id}/season.json`).year
      expect(Math.abs(d.season!.year.sunPct - cat.sunPct), `${id} sun`).toBeLessThan(2)
      expect(Math.abs(d.season!.year.earthPct - cat.earthPct), `${id} earth`).toBeLessThan(2)
      expect(evaluateScenario(d, '2027-02-01T00:00:00Z', DEFAULT_SETTINGS).count).toBe(1009)
      expect(ms, `${id} time`).toBeLessThan(10000)
    }
  }, 120000)

  it('a point off the polar grid keeps the global terrain and says so', async () => {
    const header = read<ExtendedHeader>('Site01/extended.json')
    const year = parseYear('Site01', header, bin('Site01/year.bin'))
    const polar = await polarAround(-70, 10)
    expect(polar.covers(-70, 10)).toBe(false)
    const d = freePointSiteData({ latDeg: -70, lonDeg: 10, dem: globalAround(-70, 10), polar, year, yearSite: site('Site01'), yearSha256: header.year.sha256 })
    expect(d.provenance?.horizonSource).toBe('global-dem')
    expect(d.terrain).toBeUndefined()
  }, 60000)
})
