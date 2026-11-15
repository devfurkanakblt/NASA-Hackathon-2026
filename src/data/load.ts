import type { LoadedData, Psr } from './contract.ts'
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

/** Loads the catalogue's sites once; user interaction makes no further NASA requests. */
export async function loadAllData(baseUrl = `${import.meta.env.BASE_URL}data`): Promise<LoadedData> {
  const base = baseUrl.replace(/\/+$/, '')
  const sites = validateSites(await getJson(`${base}/sites.json`), `${base}/sites.json`)
  const entries = await Promise.all(sites.sites.map(async (site) => {
    const root = `${base}/${encodeURIComponent(site.id)}`
    const [ephemeris, horizon] = await Promise.all([
      getJson(`${root}/ephemeris.json`).then((doc) => validateEphemeris(doc, site, sites.coverage, `${root}/ephemeris.json`)),
      getJson(`${root}/horizon.json`).then((doc) => validateHorizon(doc, site.id, `${root}/horizon.json`)),
    ])
    const visualWarnings: string[] = []
    const [terrain, terrainFar, earthOrientation, season, map] = await Promise.all([
      optionalVisual(`${root}/terrain.json`, (doc) => validateTerrain(doc, site.id, `${root}/terrain.json`), visualWarnings,
        `${root}/terrain.json: local 3D terrain unavailable. Scientific results remain available.`),
      // Missing regional meshes are expected for newly generated A catalogue entries.
      optionalVisual(`${root}/terrain-far.json`, (doc) => validateTerrain(doc, site.id, `${root}/terrain-far.json`), visualWarnings),
      optionalVisual(`${root}/earth-orientation.json`, (doc) => validateEarthOrientation(doc, site.id, ephemeris, `${root}/earth-orientation.json`, site), visualWarnings,
        `${root}/earth-orientation.json: registered Earth texture orientation unavailable.`),
      optionalVisual(`${root}/season.json`, (doc) => validateSeason(doc, site.id, sites.coverage, `${root}/season.json`), visualWarnings),
      site.category === 'contrast' ? Promise.resolve(undefined) :
        optionalVisual(`${root}/map.json`, (doc) => validateMap(doc, site.id, sites.coverage, `${root}/map.json`), visualWarnings),
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
    return [site.id, { site, ephemeris, horizon, terrain: displayTerrain, terrainFar: displayFar, earthOrientation, visualWarnings, season, map }] as const
  }))
  const psrWarnings: string[] = []
  const psrs = await optionalVisual(`${base}/psr-south.json`, validatePsrs, psrWarnings)
  return { sites, bySite: Object.fromEntries(entries), psrs }
}
