import { loadGlobalDemAround } from './globalDem.ts'
import type { GlobalTerrain } from '../scene3d/globalTerrain.ts'
import type { EphemerisDoc, LoadedData, Provenance, Psr, SiteData, SiteEntry } from './contract.ts'
import { validateCoverage } from './coverage.ts'
import { validateTerrainNormal } from './terrainNormal.ts'
import { validateLunarImagery } from './lunarImagery.ts'
import { validateEarthOrientation, validateEphemeris, validateHorizon, validateMap, validateSeason, validateSites, validateTerrain } from './validate.ts'

class HttpError extends Error {
  status: number
  constructor(url: string, status: number) {
    super(`${url}: HTTP ${status}`)
    this.status = status
  }
}

async function getJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(`${url}: network request failed (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!response.ok) throw new HttpError(url, response.status)
  try {
    return await response.json()
  } catch {
    throw new Error(`${url}: response is not valid JSON`)
  }
}

/** Optional visuals never replace or suppress required scientific data. */
async function optionalVisual<T>(url: string, parse: (value: unknown) => T, warnings: string[], missingWarning?: string): Promise<T | undefined> {
  try {
    return parse(await getJson(url))
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      if (missingWarning) warnings.push(missingWarning)
    } else {
      warnings.push(`${error instanceof Error ? error.message : String(error)}. Visual unavailable; scientific results remain available.`)
    }
    return undefined
  }
}

/** `psr-south.json`: NASA Moon Trek PSR list; malformed entries reject the whole optional file. */
function validatePsrs(value: unknown): Psr[] {
  const list = (value as { psrs?: unknown })?.psrs
  if (!Array.isArray(list) || list.length === 0) throw new Error('psr-south.json: no PSR list')
  for (const p of list as Psr[]) {
    if (typeof p.id !== 'string' || !(p.areaKm2 > 0) || !(p.latDeg >= -90 && p.latDeg <= 0) || !(p.lonDeg >= -180 && p.lonDeg <= 180)) {
      throw new Error('psr-south.json: malformed PSR entry')
    }
  }
  return list as Psr[]
}

/** Display-only files of one site: 3D terrain, imagery, Earth orientation. */
export type SiteVisuals = Pick<SiteData, 'terrain' | 'terrainFar' | 'earthOrientation' | 'visualWarnings'>

/**
 * Fetches one site's display files. They are several megabytes per site, so the app loads them
 * only for the places that are shown; the scientific results never wait for them.
 */
export async function loadSiteVisuals(site: SiteEntry, ephemeris: EphemerisDoc, baseUrl = `${import.meta.env.BASE_URL}data`): Promise<SiteVisuals> {
  const root = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(site.id)}`
  const visualWarnings: string[] = []
  const [terrain, terrainFar, earthOrientation] = await Promise.all([
    optionalVisual(`${root}/terrain.json`, (doc) => validateTerrain(doc, site.id, `${root}/terrain.json`), visualWarnings,
      `${root}/terrain.json: local 3D terrain unavailable. Scientific results remain available.`),
    // Missing regional meshes are expected for newly generated A catalogue entries.
    optionalVisual(`${root}/terrain-far.json`, (doc) => validateTerrain(doc, site.id, `${root}/terrain-far.json`), visualWarnings),
    optionalVisual(`${root}/earth-orientation.json`, (doc) => validateEarthOrientation(doc, site.id, ephemeris, `${root}/earth-orientation.json`, site), visualWarnings,
      `${root}/earth-orientation.json: registered Earth texture orientation unavailable.`),
  ])
  const [normalManifest, localImagery, farImagery] = await Promise.all([
    terrain && site.category !== 'contrast'
    ? optionalVisual(`${root}/terrain-normal.json`, doc => validateTerrainNormal(doc, site, terrain.sizeM, `${root}/terrain-normal.json`), visualWarnings)
    : undefined,
    terrain ? optionalVisual(`${root}/lunar-imagery.json`, doc => validateLunarImagery(doc, site, terrain.sizeM, false, `${root}/lunar-imagery.json`), visualWarnings) : undefined,
    terrainFar ? optionalVisual(`${root}/lunar-imagery-far.json`, doc => validateLunarImagery(doc, site, terrainFar.sizeM, true, `${root}/lunar-imagery-far.json`), visualWarnings) : undefined,
  ])
  const displayTerrain = terrain ? {
    ...terrain,
    ...(normalManifest && { normalDetail: { manifest: normalManifest, textureUrl: `${root}/${normalManifest.file}?v=${normalManifest.sha256}` } }),
    ...(localImagery && { imagery: { manifest: localImagery, textureUrl: `${root}/${localImagery.file}?v=${localImagery.sha256}` } }),
  } : terrain
  const displayFar = terrainFar && farImagery ? { ...terrainFar, imagery: { manifest: farImagery, textureUrl: `${root}/${farImagery.file}?v=${farImagery.sha256}` } } : terrainFar
  return { terrain: displayTerrain, terrainFar: displayFar, earthOrientation, visualWarnings }
}

/**
 * Loads the catalogue's sites once; user interaction makes no further NASA requests.
 * `visuals: false` skips the per-site display files (see loadSiteVisuals), which the app
 * then fetches only for the places it shows.
 */
export async function loadAllData(baseUrl = `${import.meta.env.BASE_URL}data`, { visuals = true }: { visuals?: boolean } = {}): Promise<LoadedData> {
  const base = baseUrl.replace(/\/+$/, '')
  const sites = validateSites(await getJson(`${base}/sites.json`), `${base}/sites.json`)
  const entries = await Promise.all(sites.sites.map(async (site) => {
    const root = `${base}/${encodeURIComponent(site.id)}`
    const [ephemeris, horizon] = await Promise.all([
      getJson(`${root}/ephemeris.json`).then((doc) => validateEphemeris(doc, site, sites.coverage, `${root}/ephemeris.json`)),
      getJson(`${root}/horizon.json`).then((doc) => validateHorizon(doc, site.id, `${root}/horizon.json`)),
    ])
    const contextWarnings: string[] = []
    const [shown, season, map] = await Promise.all([
      visuals ? loadSiteVisuals(site, ephemeris, base) : Promise.resolve<SiteVisuals>({}),
      optionalVisual(`${root}/season.json`, (doc) => validateSeason(doc, site.id, sites.coverage, `${root}/season.json`), contextWarnings),
      site.category === 'contrast' ? Promise.resolve(undefined) :
        optionalVisual(`${root}/map.json`, (doc) => validateMap(doc, site.id, sites.coverage, `${root}/map.json`), contextWarnings),
    ])
    const visualWarnings = [...(shown.visualWarnings ?? []), ...contextWarnings]
    const provenance: Provenance = {
      latDeg: site.latDeg, lonDeg: site.lonDeg, observerHeightM: site.observerHeightM,
      eyeM: site.surfaceElevationM + site.observerHeightM,
      horizonResolutionDeg: horizon.azStepDeg, horizonSource: 'catalogue',
      ephemerisSource: ephemeris.source, dataHash: null, precision: 'catalogue', coverageWarnings: [...(horizon.warnings ?? [])],
    }
    const data: SiteData = { site, ephemeris, horizon, terrain: shown.terrain, terrainFar: shown.terrainFar, earthOrientation: shown.earthOrientation, visualWarnings, season, map, provenance }
    return [site.id, data] as const
  }))
  const psrWarnings: string[] = []
  const psrs = await optionalVisual(`${base}/psr-south.json`, validatePsrs, psrWarnings)
  // Optional: a missing or invalid coverage.json only removes the supported-area report.
  const coverage = await optionalVisual(`${base}/coverage.json`, doc => validateCoverage(doc, `${base}/coverage.json`), [])
  return { sites, bySite: Object.fromEntries(entries), psrs, ...(coverage && { coverage }) }
}

let globalTerrainPending: Promise<GlobalTerrain> | undefined

interface DisplayDemDoc { file: string; rows: number; cols: number; scaleM: number; radiusM: number; bytes: number; sha256: string }

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, '0')).join('')
}

/** Mean height of the first and last grid rows: the display mesh welds each pole to one value. */
function poleMeans(values: Int16Array, rows: number, cols: number, scaleM: number): { northPoleM: number; southPoleM: number } {
  let north = 0, south = 0
  for (let c = 0; c < cols; c++) { north += values[c]; south += values[(rows - 1) * cols + c] }
  return { northPoleM: north / cols * scaleM, southPoleM: south / cols * scaleM }
}

/**
 * Whole-Moon display heights for the place-picker globe: one 2 MB grid (`global-dem/display-4ppd`,
 * a 4 x 4 block mean of A/D's checked LOLA tiles, see preprocess/global_display_dem.py) instead of
 * all 72 tiles (33 MB). Zoomed-in views and custom points use `loadDetailTerrain`.
 */
export function loadGlobalTerrain(base = `${import.meta.env.BASE_URL}data/global-dem`): Promise<GlobalTerrain> {
  return globalTerrainPending ??= (async () => {
    const doc = await getJson(`${base}/display-4ppd.json`) as DisplayDemDoc
    const response = await fetch(`${base}/${doc.file}`)
    if (!response.ok) throw new HttpError(`${base}/${doc.file}`, response.status)
    const buf = await response.arrayBuffer()
    if (buf.byteLength !== doc.bytes || buf.byteLength !== doc.rows * doc.cols * 2) throw new Error(`${doc.file}: unexpected size ${buf.byteLength}`)
    if ((await sha256Hex(buf)) !== doc.sha256) throw new Error(`${doc.file}: sha256 mismatch`)
    const values = new Int16Array(buf)
    return { width: doc.cols, height: doc.rows, scaleM: doc.scaleM, referenceRadiusM: doc.radiusM, values, ...poleMeans(values, doc.rows, doc.cols, doc.scaleM) }
  })().catch(error => { globalTerrainPending = undefined; throw error })
}

/**
 * Full-resolution LOLA heights (~1.9 km/px) within `rangeM` of a point: only the global tiles
 * that cover it are fetched (cached per tile). Pole values come from the display grid.
 */
export async function loadDetailTerrain(latDeg: number, lonDeg: number, rangeM: number): Promise<GlobalTerrain> {
  const [dem, overview] = await Promise.all([loadGlobalDemAround(latDeg, lonDeg, rangeM), loadGlobalTerrain()])
  const m = dem.manifest
  return { width: m.cols, height: m.rows, scaleM: m.scaleM, referenceRadiusM: m.radiusM,
    heightAt: (lat: number, lon: number) => dem.heightAt(lat, lon),
    northPoleM: overview.northPoleM, southPoleM: overview.southPoleM }
}
