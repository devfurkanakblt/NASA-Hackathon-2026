import type { EphemerisDoc, HorizonDoc, LoadedData, SitesDoc, TerrainDoc } from './contract.ts'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/**
 * Loads `sites.json` and every site's files in one go. After this resolves the app makes
 * no further network requests: every later calculation runs on what is in memory.
 */
export async function loadAllData(baseUrl = `${import.meta.env.BASE_URL}data`): Promise<LoadedData> {
  const sites = await getJson<SitesDoc>(`${baseUrl}/sites.json`)
  const entries = await Promise.all(
    sites.sites.map(async (site) => {
      const [terrain, horizon, ephemeris, terrainFar] = await Promise.all([
        getJson<TerrainDoc>(`${baseUrl}/${site.id}/terrain.json`),
        getJson<HorizonDoc>(`${baseUrl}/${site.id}/horizon.json`),
        getJson<EphemerisDoc>(`${baseUrl}/${site.id}/ephemeris.json`),
        // optional: the 3D overview falls back to a smooth sphere without it
        getJson<TerrainDoc>(`${baseUrl}/${site.id}/terrain-far.json`).catch(() => undefined),
      ])
      return [site.id, { site, terrain, horizon, ephemeris, terrainFar }] as const
    }),
  )
  return { sites, bySite: Object.fromEntries(entries) }
}
