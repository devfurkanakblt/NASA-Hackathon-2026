import { describe, expect, it } from 'vitest'
import type { SiteData } from '../data/contract.ts'
import { mapPointWhere, placeTitle } from './placeName.ts'

const site01 = {
  site: { id: 'Site01', name: 'Connecting Ridge' },
  map: { grid: { nx: 61, ny: 61, spacingM: 100, halfSizeM: 3000 } },
} as unknown as SiteData
const bySite = { Site01: site01 }

describe('place names', () => {
  it('describes a map point by distance and direction from its site', () => {
    expect(mapPointWhere('Site01:r36c32', bySite)).toBe('630 m north of Site01')
    expect(mapPointWhere('Site01:r30c30', bySite)).toBe("centre of Site01's map")
    expect(mapPointWhere('Site01:r30c0', bySite)).toBe('3.0 km west of Site01')
    expect(mapPointWhere('Site01', bySite)).toBeNull()
    expect(mapPointWhere('Nowhere:r1c1', bySite)).toBeNull()
  })

  it('titles a map point by its site', () => {
    expect(placeTitle('Site01:r36c32', bySite)).toBe('Map point near Connecting Ridge')
    expect(placeTitle('Site01', bySite)).toBe('Connecting Ridge')
    expect(placeTitle('X', bySite)).toBe('X')
  })
})
