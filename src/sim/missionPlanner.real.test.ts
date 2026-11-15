/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import type { SiteData, SitesDoc } from '../data/contract.ts'
import { computeFreePoint } from '../app/freePointLoader.ts'
import { plannerDiagnostics } from '../app/plannerDiagnostics.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from './evaluate.ts'
import { findMissionForPlace } from './missionPlanner.ts'
import type { SearchMetric } from './search.ts'

afterEach(() => vi.unstubAllGlobals())

it('explains the reported far-side rejection and distinguishes tie breaking from feasibility', async () => {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    try { return new Response(readFileSync(fileURLToPath(new URL(`../../public/${String(url).replace(/^\//, '')}`, import.meta.url))), { status: 200 }) }
    catch { return new Response('Missing test data', { status: 404 }) }
  })
  const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${path}`, import.meta.url)), 'utf8'))
  const sites = read('sites.json') as SitesDoc
  const reference: SiteData = { site: sites.sites.find(s => s.id === 'Site01')!, ephemeris: read('Site01/ephemeris.json'), horizon: read('Site01/horizon.json') }
  const settings = { ...DEFAULT_SETTINGS, durationDays: 27, panelAreaM2: 10 }
  for (const id of ['pt:-78.58281:-129.54920', 'pt:-52.53721:-113.79337']) {
    const data = await computeFreePoint(id, { Site01: reference })
    for (const sortBy of ['minSoc', 'bothVisible', 'earthOutage'] as SearchMetric[]) {
      const found = await findMissionForPlace({ data, settings, fromUtc: '2026-11-15T00:00:00Z', toUtc: '2027-11-01T00:00:00Z', maxDurationDays: 90, sortBy })
      expect(found.best).toBeNull()
      expect(found.tested).toBe(352)
      expect(found.durationScreening).toEqual({ minimumDays: 1, startsTested: 352, coveredStarts: 351, earthHiddenAtEveryCoveredStart: true })
      expect(found.failureCounts.earthOutage).toBe(351)
      expect(found.failureCounts.coverage).toBe(1)
      expect(found.notes[0]).toContain('24-hour direct-to-Earth outage')
      expect(found.notes[0]).toContain('maximum is 6 hours')
      const diagnostics = plannerDiagnostics(found)
      expect(diagnostics.denominator).toBe(352)
      expect(diagnostics.failures.find(f => f.code === 'earthOutage')?.count).toBe(351)
      const attempt = found.rejected.find(c => c.summary)!
      expect(attempt.durationDays).toBe(1)
      expect(attempt.summary).toEqual(evaluateScenario(data, attempt.startUtc, { ...settings, durationDays: 1 }).summary)
    }
    // Explicitly changing the communication requirement can permit a mission;
    // neither the algorithm nor the UI relaxes that requirement automatically.
    const relaxed = await findMissionForPlace({ data, settings: { ...settings, maxEarthOutageH: 24 }, fromUtc: '2026-11-15T00:00:00Z', toUtc: '2027-10-31T00:00:00Z', maxDurationDays: 90 })
    expect(relaxed.best?.durationDays).toBe(1)
  }
}, 120000)
