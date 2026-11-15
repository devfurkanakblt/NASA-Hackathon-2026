/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import type { EarthOrientationDoc } from '../data/contract.ts'
import { apparentSphereRadius, earthOrientationAt, earthOrientationCoverageWarning, earthSunDirectionAt, geographicUv, illuminatedFraction, rotationInAimFrame } from './appearance.ts'

describe('astronomical appearance geometry', () => {
  it('preserves the limb angle of a sphere, not the radius of a flat marker', () => {
    const r = apparentSphereRadius(100000, 1.96)
    expect(2 * Math.asin(r / 100000) * 180 / Math.PI).toBeCloseTo(1.96, 12)
  })
  it('has new, quarter and full Earth at the geometrically correct Sun directions', () => {
    expect(illuminatedFraction([0, 0, -1], [0, 0, -1])).toBe(0)
    expect(illuminatedFraction([0, 0, -1], [1, 0, 0])).toBe(0.5)
    expect(illuminatedFraction([0, 0, -1], [0, 0, 1])).toBe(1)
  })
  it('registers real equirectangular geography without mirrored east/west', () => {
    expect(geographicUv(0, 0)).toEqual([0.5, 0.5])
    expect(geographicUv(90, 0)).toEqual([0.75, 0.5])
    expect(geographicUv(-90, 0)).toEqual([0.25, 0.5])
    expect(geographicUv(0, 90)[1]).toBe(1)
  })
  it('keeps north and Greenwich world orientation independent of the body position aim', () => {
    const world = new Quaternion().setFromEuler(new Euler(0.2, 1.2, -0.7))
    const aim = new Quaternion().setFromEuler(new Euler(0.03, -1.8, 0, 'YXZ'))
    const local = new Quaternion(...rotationInAimFrame(1.8 * 180 / Math.PI, 0.03 * 180 / Math.PI, world.toArray() as [number,number,number,number]))
    const restored = aim.multiply(local)
    expect(Math.abs(restored.dot(world))).toBeCloseTo(1, 12)
  })
})

describe('Earth orientation time sampling', () => {
  const doc = { startUtc: '2026-11-01T00:00:00Z', stepS: 600, count: 2,
    quaternionXyzw: [[0, 0, 0, 1], [0, Math.sin(Math.PI/4), 0, Math.cos(Math.PI/4)]],
    sunDirectionAtEarth: [[1,0,0],[0,1,0]],
  } as EarthOrientationDoc
  it('interpolates by spherical rotation rather than linearly blending longitudes', () => {
    const q = earthOrientationAt(doc, '2026-11-01T00:05:00Z')!
    const x = new Vector3(1,0,0).applyQuaternion(new Quaternion(...q))
    expect(x.x).toBeCloseTo(Math.SQRT1_2, 10)
    expect(x.z).toBeCloseTo(-Math.SQRT1_2, 10)
    expect(Math.hypot(...earthSunDirectionAt(doc, '2026-11-01T00:05:00Z')!)).toBeCloseTo(1,12)
  })
  it('does not invent orientation before or after the source coverage', () => {
    expect(earthOrientationAt(doc, '2026-10-31T23:59:59Z')).toBeUndefined()
    expect(earthOrientationAt(doc, '2026-11-01T00:10:01Z')).toBeUndefined()
    expect(earthOrientationAt(undefined, doc.startUtc)).toBeUndefined()
    expect(earthOrientationCoverageWarning(doc, '2026-11-01T00:10:01Z')).toContain('this mission UTC')
    expect(earthOrientationCoverageWarning(doc, '2026-11-01T00:05:00Z')).toBeUndefined()
    expect(earthOrientationCoverageWarning(undefined, doc.startUtc)).toContain('missing for this site')
  })
  it('accepts equivalent opposite signs at quaternion endpoints', () => {
    const equivalent = { ...doc, quaternionXyzw: [[0,0,0,1],[0,0,0,-1]] } as EarthOrientationDoc
    expect(Math.abs(earthOrientationAt(equivalent, '2026-11-01T00:05:00Z')![3])).toBeCloseTo(1,12)
  })
})

it('all nine published hourly Earth displays cover annual scenarios including intermediate epochs', () => {
  const data = new URL('../../public/data/', import.meta.url)
  const sites = JSON.parse(readFileSync(new URL('sites.json', data), 'utf8')).sites as { id: string }[]
  for (const { id } of sites) {
    const orientation = JSON.parse(readFileSync(new URL(`${id}/earth-orientation.json`, data), 'utf8')) as EarthOrientationDoc
    expect(orientation.stepS).toBe(3600)
    expect(orientation.count).toBe(8761)
    for (const utc of ['2026-11-01T00:00:00Z', '2027-04-10T00:30:00Z', '2027-10-31T23:50:00Z', '2027-11-01T00:00:00Z']) {
      expect(earthOrientationCoverageWarning(orientation, utc)).toBeUndefined()
      expect(Math.hypot(...earthOrientationAt(orientation, utc)!)).toBeCloseTo(1, 10)
      expect(Math.hypot(...earthSunDirectionAt(orientation, utc)!)).toBeCloseTo(1, 10)
    }
    expect(earthOrientationAt(orientation, '2027-11-01T00:00:01Z')).toBeUndefined()
  }
})
