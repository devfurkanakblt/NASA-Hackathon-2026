import type { EphemerisDoc, HorizonDoc, LoadedData, MapDoc, SeasonDoc, SitesDoc, TerrainDoc } from './contract.ts'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** For files the app can do without: a missing one leaves its panel showing "not available". */
const optional = <T>(promise: Promise<T>): Promise<T | undefined> => promise.catch(() => undefined)

/**
 * Loads `sites.json` and every site's files in one go. After this resolves the app makes
 * no further network requests: every later calculation runs on what is in memory.
 * `terrain`, `horizon` and `ephemeris` are required; `season.json` and `map.json` are optional
 * (contrast points have no `map.json`, so it is not requested for them).
 */
export async function loadAllData(baseUrl = `${import.meta.env.BASE_URL}data`): Promise<LoadedData> {
  const sites = await getJson<SitesDoc>(`${baseUrl}/sites.json`)
  const entries = await Promise.all(
    sites.sites.map(async (site) => {
      const dir = `${baseUrl}/${site.id}`
      const [terrain, horizon, ephemeris, season, map] = await Promise.all([
        getJson<TerrainDoc>(`${dir}/terrain.json`),
        getJson<HorizonDoc>(`${dir}/horizon.json`),
        getJson<EphemerisDoc>(`${dir}/ephemeris.json`),
        optional(getJson<SeasonDoc>(`${dir}/season.json`)),
        site.category === 'contrast' ? Promise.resolve(undefined) : optional(getJson<MapDoc>(`${dir}/map.json`)),
      ])
      return [site.id, { site, terrain, horizon, ephemeris, season, map }] as const
    }),
  )
  return { sites, bySite: Object.fromEntries(entries) }
}
