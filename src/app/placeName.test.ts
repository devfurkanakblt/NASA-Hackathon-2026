import { describe, expect, it } from 'vitest'
import type { SiteData } from '../data/contract.ts'
import { mapPointWhere, placeLatLon, placeTitle } from './placeName.ts'

const site01 = {
  site: { id: 'Site01', name: 'Connecting Ridge' },
  map: { grid: { nx: 61, ny: 61, spacingM: 100, halfSizeM: 3000 } },
} as unknown as SiteData
const bySite = { Site01: site01 }

describe('place names', () => {
  it('gives coordinates for free points and catalogue sites, not for map points', () => {
    const withCoords = { Site01: { ...site01, site: { ...site01.site, latDeg: -89.4, lonDeg: -137.3 } } as SiteData }
    expect(placeLatLon('pt:-81.00000:25.71429', withCoords)).toEqual({ latDeg: -81, lonDeg: 25.71429 })
    expect(placeLatLon('Site01', withCoords)).toEqual({ latDeg: -89.4, lonDeg: -137.3 })
    expect(placeLatLon('Site01:r36c32', withCoords)).toBeNull()
  })

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
