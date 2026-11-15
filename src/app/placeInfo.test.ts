/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SitesDoc } from '../data/contract.ts'
import { placeInfo } from './PlaceInfo.tsx'

const sites = (JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/sites.json', import.meta.url)), 'utf8')) as SitesDoc).sites
const site = (id: string) => sites.find((s) => s.id === id)!

describe('globe info window', () => {
  it('states only catalogue facts and never invents a research type', () => {
    for (const s of sites) {
      const i = placeInfo(s)
      expect(i.research).toMatch(/not been verified yet/)
      expect(i.details).toContain(s.label)
      expect(i.details.some((d) => d.startsWith('Coordinate source: '))).toBe(true)
    }
  })
  it('names the kind of point', () => {
    expect(placeInfo(site('VIPER')).kind).toBe('Planned target of a future mission (not a landing yet)')
    expect(placeInfo(site('Apollo16')).kind).toBe('Historical landing site')
    expect(placeInfo(site('Site04R')).kind).toBe('Point derived from Site04')
    expect(placeInfo(site('Site01')).coordinate).toBe('89.463°S, 137.490°W')
  })
})
