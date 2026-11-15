/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import type { SiteData, SitesDoc } from '../data/contract.ts'
import { findSouthernPlaces } from './hemisphere.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { computeFreePoint } from '../app/freePointLoader.ts'
import { parseFreePointId } from './freePoint.ts'

afterEach(() => vi.unstubAllGlobals())

it('screens the whole southern hemisphere with real local terrain and rechecks the recommendation', async () => {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    try {
      const path = String(url).replace(/^\//, '')
      const bytes = readFileSync(fileURLToPath(new URL(`../../public/${path}`, import.meta.url)))
      return new Response(bytes, { status: 200 })
    } catch { return new Response('Missing test data', { status: 404 }) }
  })
  const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)), 'utf8'))
  const sites = read('sites.json') as SitesDoc
  const reference: SiteData = { site: sites.sites.find(s => s.id === 'Site01')!, horizon: read('Site01/horizon.json'), ephemeris: read('Site01/ephemeris.json') }
  const settings = { ...DEFAULT_SETTINGS, durationDays: 1 }
  // Nonzero source offset exercises mission-window projection, not just sample zero.
  const startUtc = '2026-11-05T00:00:00Z'
  const result = await findSouthernPlaces({ reference, settings, startUtc, spacingDeg: 15, sortBy: 'minSoc', region: 'hemisphere' })
  expect(result.status).toBe('complete')
  expect(result.spatialCoverage.places).toBeGreaterThan(150)
  expect(result.best).not.toBeNull()
  expect(result.feasible.every(c => c.precision === 'global' && parseFreePointId(c.siteId)!.latDeg < 0)).toBe(true)
  const point = await computeFreePoint(result.best!.siteId, { Site01: reference })
  const direct = evaluateScenario(point, startUtc, settings)
  expect(result.best!.summary!.minSocFraction).toBeCloseTo(direct.summary.minSocFraction, 9)
  expect(result.best!.summary!.longestEarthOutageS).toBeCloseTo(direct.summary.longestEarthOutageS, 6)
  expect(result.best!.summary!.bothVisibleFraction).toBeCloseTo(direct.summary.bothVisibleFraction, 9)
}, 120000)
