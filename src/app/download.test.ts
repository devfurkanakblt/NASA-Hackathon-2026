/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SiteData, SitesDoc } from '../data/contract.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../sim/evaluate.ts'
import { csvFileName, scenarioCsv } from './download.ts'

const DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const read = <T>(p: string): T => JSON.parse(readFileSync(DIR + p, 'utf8')) as T

describe('CSV download', () => {
  it('names the file safely and carries the D export schema', () => {
    const d: SiteData = { site: read<SitesDoc>('sites.json').sites.find((s) => s.id === 'Site04R')!, ephemeris: read('Site04R/ephemeris.json'), horizon: read('Site04R/horizon.json') }
    const r = evaluateScenario(d, '2026-11-15T00:00:00Z', DEFAULT_SETTINGS)
    expect(csvFileName(r, DEFAULT_SETTINGS)).toBe('Site04R_2026-11-15T0000Z_7d.csv')
    expect(csvFileName({ ...r, siteId: 'pt:-8.97000:15.50000' }, DEFAULT_SETTINGS)).toBe('pt--8.97000-15.50000_2026-11-15T0000Z_7d.csv') // ':' -> '-', the minus sign is kept
    const csv = scenarioCsv(d, r, DEFAULT_SETTINGS)
    expect(csv.split('\n').filter((l) => l && !l.startsWith('#'))).toHaveLength(r.count + 1)
  })
})
