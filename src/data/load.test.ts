/**
 * Acceptance check from the plan (§5 "Kullanım"): a missing data file must fail loudly,
 * naming the file, instead of leaving the app with partial data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAllData } from './load.ts'

const files: Record<string, unknown> = {
  'data/sites.json': { sites: [{ id: 'A' }, { id: 'B', category: 'contrast' }] },
  'data/A/terrain.json': {},
  'data/A/horizon.json': {},
  'data/A/ephemeris.json': {},
  'data/B/terrain.json': {},
  'data/B/ephemeris.json': {},
  // data/B/horizon.json is missing
}

function stubFetch(available: Record<string, unknown>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const body = available[url]
    return body === undefined
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => body }
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('loadAllData', () => {
  it('loads every site file once, from the given base path', async () => {
    const calls = stubFetch({ ...files, 'data/B/horizon.json': {} })
    const data = await loadAllData('data')
    expect(Object.keys(data.bySite)).toEqual(['A', 'B'])
    // 1 sites.json + 3 required files each + season.json each + map.json for A only (B is a contrast point)
    expect(calls).toHaveLength(10)
    expect(calls).not.toContain('data/B/map.json')
  })

  it('opens without the optional season.json and map.json', async () => {
    stubFetch({ ...files, 'data/B/horizon.json': {}, 'data/A/season.json': { months: [] } })
    const data = await loadAllData('data')
    expect(data.bySite.A.season).toEqual({ months: [] })
    expect(data.bySite.A.map).toBeUndefined()
    expect(data.bySite.B.season).toBeUndefined()
  })

  it('rejects with the name of a missing file', async () => {
    stubFetch(files)
    await expect(loadAllData('data')).rejects.toThrow('data/B/horizon.json: HTTP 404')
  })

  it('rejects when sites.json itself is missing', async () => {
    stubFetch({})
    await expect(loadAllData('data')).rejects.toThrow('data/sites.json: HTTP 404')
  })
})
