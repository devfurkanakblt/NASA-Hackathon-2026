/// <reference types="node" />
/**
 * Regional map and season panels on the real files: the map numbers shown on screen
 * (presentation notes, team notes) and the season file's link to the reference table.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellAt, centreCell, rampColor, rampFor, sitesOnMap } from '../src/app/mapGrid.ts'
import type { MapDoc, SeasonDoc, SitesDoc } from '../src/data/contract.ts'

const DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url))
const read = <T>(path: string): T => JSON.parse(readFileSync(DATA_DIR + path, 'utf8')) as T
const sites = read<SitesDoc>('sites.json')

describe('regional map', () => {
  const site01 = read<MapDoc>('Site01/map.json')

  it('reads the Site01 centre and the ridge cell north-east of it', () => {
    const c = centreCell(site01)
    expect([c.eastM, c.northM]).toEqual([0, 0])
    expect(c.sunPct).toBeCloseTo(72.5, 0)
    expect(c.earthPct).toBeCloseTo(36.5, 0)
    // +200 m east, +600 m north: row 36, column 32
    const ridge = cellAt(site01, 36, 32)
    expect([ridge.eastM, ridge.northM]).toEqual([200, 600])
    expect(ridge.sunPct).toBeCloseTo(100, 0)
    expect(ridge.earthPct).toBeCloseTo(48.9, 0)
    expect(ridge.slopeDeg).toBeCloseTo(4.7, 0)
  })

  it('places Site04R on the Site04 map about 1.9 km from the catalogue point', () => {
    const on = sitesOnMap(read<MapDoc>('Site04/map.json'), sites.sites)
    const ridge = on.find((o) => o.site.id === 'Site04R')
    expect(ridge).toBeDefined()
    expect(ridge!.cell.distanceM / 1000).toBeCloseTo(1.9, 0)
    expect(on.some((o) => o.site.id === 'Site04')).toBe(false)
  })

  it('has regional maps for the seven original regions; mission points do not imply map coverage', () => {
    for (const site of sites.sites) {
      const exists = (() => {
        try {
          return read<MapDoc>(`${site.id}/map.json`).sunPct.length > 0
        } catch {
          return false
        }
      })()
      expect([site.id, exists]).toEqual([site.id, ['Site01', 'Site04', 'Site04R', 'Site07', 'Site11', 'Site20', 'Site23'].includes(site.id)])
    }
  })

  it('maps values onto the ramp ends', () => {
    expect(rampColor(rampFor('sunPct'), 0)).toEqual([22, 20, 15])
    expect(rampColor(rampFor('sunPct'), 1)).toEqual([255, 231, 168])
    expect(rampColor(rampFor('earthPct'), 1)).toEqual([205, 219, 255])
    expect(rampColor(rampFor('sunPct'), Number.NaN)).toEqual([22, 20, 15])
  })
})

describe('season summary', () => {
  it('shows the Site07 seasonal effect from the team notes', () => {
    const s = read<SeasonDoc>('Site07/season.json')
    expect(s.months).toHaveLength(12)
    expect(s.months[0].month).toBe('2026-11')
    expect(s.months[0].sunPct).toBeCloseTo(100, 0)
    expect(s.months.find((m) => m.month === '2027-04')!.sunPct).toBeCloseTo(14, -1)
    expect(Math.round(s.year.sunPct)).toBe(68)
  })
})
