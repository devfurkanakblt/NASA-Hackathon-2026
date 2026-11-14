import { describe, expect, it } from 'vitest'
import {
  azElToUnitVector,
  bodyStatus,
  cosIncidence,
  earthAngularDiameterDeg,
  horizonDistanceAt,
  horizonElevationAt,
  normalizeAzimuth,
  panelIsLit,
  panelNormal,
  panelSize,
  sunAngularDiameterDeg,
  vectorToAzEl,
} from './coords.ts'
import type { BodyState, HorizonProfile, PanelState } from './types.ts'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('azElToUnitVector', () => {
  it('maps the cardinal directions to +X = east, −Z = north, +Y = up', () => {
    const north = azElToUnitVector(0, 0)
    const east = azElToUnitVector(90, 0)
    const south = azElToUnitVector(180, 0)
    const west = azElToUnitVector(270, 0)
    const up = azElToUnitVector(123, 90)
    ;[north, east, south, west, up].forEach((v, i) => {
      const expected = [
        [0, 0, -1],
        [1, 0, 0],
        [0, 0, 1],
        [-1, 0, 0],
        [0, 1, 0],
      ][i]
      v.forEach((c, k) => close(c, expected[k]))
    })
  })

  it('is right-handed: east × north = up', () => {
    const e = azElToUnitVector(90, 0)
    const n = azElToUnitVector(0, 0)
    const cross = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]]
    close(cross[0], 0)
    close(cross[1], 1)
    close(cross[2], 0)
  })

  it('returns unit vectors and round-trips through vectorToAzEl', () => {
    for (const [az, el] of [
      [0.05, -1.3],
      [137.49, 1.54],
      [359.95, 6.7],
      [224, -12],
    ]) {
      const v = azElToUnitVector(az, el)
      close(Math.hypot(...v), 1)
      const back = vectorToAzEl(v)
      close(back.azDeg, az, 1e-9)
      close(back.elDeg, el, 1e-9)
    }
  })
})

describe('normalizeAzimuth', () => {
  it('wraps into [0, 360)', () => {
    close(normalizeAzimuth(-10), 350)
    close(normalizeAzimuth(370), 10)
    close(normalizeAzimuth(360), 0)
    close(normalizeAzimuth(-720), 0)
  })
})

describe('horizonElevationAt', () => {
  // 0.1° profile whose value equals its sample index, so interpolation is easy to check.
  const profile: HorizonProfile = {
    azStepDeg: 0.1,
    elevDeg: Array.from({ length: 3600 }, (_, i) => i),
    distanceM: Array.from({ length: 3600 }, (_, i) => i * 10),
  }

  it('returns the sample exactly on a grid azimuth', () => {
    close(horizonElevationAt(profile, 0), 0, 1e-6)
    close(horizonElevationAt(profile, 12.3), 123, 1e-6)
    close(horizonElevationAt(profile, 359.9), 3599, 1e-6)
  })

  it('interpolates linearly between samples', () => {
    close(horizonElevationAt(profile, 12.35), 123.5, 1e-6)
  })

  it('wraps from the last sample back to the first across 359.9° → 0°', () => {
    close(horizonElevationAt(profile, 359.95), 3599 / 2, 1e-6)
    close(horizonElevationAt(profile, -0.05), 3599 / 2, 1e-6)
    close(horizonElevationAt(profile, 360), 0, 1e-6)
    close(horizonElevationAt(profile, 372.3), 123, 1e-6)
  })

  it('handles an empty profile', () => {
    expect(horizonElevationAt({ azStepDeg: 0.1, elevDeg: [] }, 42)).toBe(0)
  })

  it('matches the shared visibility rule of the data contract', () => {
    // horizonAt() copied from docs/data-contract.md
    const horizonAt = (h: { azStepDeg: number; count: number; elevDeg: number[] }, azDeg: number) => {
      const x = (((azDeg % 360) + 360) % 360) / h.azStepDeg
      const i0 = Math.floor(x) % h.count
      const i1 = (i0 + 1) % h.count
      const f = x - Math.floor(x)
      return h.elevDeg[i0] * (1 - f) + h.elevDeg[i1] * f
    }
    const elevDeg = Array.from({ length: 3600 }, (_, i) => 3 * Math.sin(i / 57) - 1)
    for (const az of [0, 0.04, 17.77, 123.456, 359.95, 359.99, -12.3, 725.5]) {
      close(horizonElevationAt({ azStepDeg: 0.1, elevDeg }, az), horizonAt({ azStepDeg: 0.1, count: 3600, elevDeg }, az), 1e-9)
    }
  })

  it('reports the distance of the terrain that forms the horizon', () => {
    expect(horizonDistanceAt(profile, 12.3)).toBe(1230)
    expect(horizonDistanceAt(profile, 12.34)).toBe(1230)
    expect(horizonDistanceAt(profile, 359.97)).toBe(0)
    expect(horizonDistanceAt({ azStepDeg: 0.1, elevDeg: [1, 2] }, 10)).toBeUndefined()
  })
})

describe('apparent sizes', () => {
  it('scales the Sun with distance, 0.533° at 1 au', () => {
    close(sunAngularDiameterDeg(1.495978707e11), 0.5332, 1e-9)
    close(sunAngularDiameterDeg(), 0.5332, 1e-9)
    expect(sunAngularDiameterDeg(0.9823 * 1.495978707e11)).toBeGreaterThan(0.5332)
  })

  it('gives Earth about 1.9° from the Moon', () => {
    close(earthAngularDiameterDeg(3.844e8), 1.8993, 1e-3)
    expect(earthAngularDiameterDeg(3.565e8)).toBeGreaterThan(earthAngularDiameterDeg(4.065e8))
    close(earthAngularDiameterDeg(), earthAngularDiameterDeg(3.844e8), 1e-12)
  })
})

describe('bodyStatus', () => {
  const body = (elDeg: number, visible: boolean): BodyState => ({ azDeg: 10, elDeg, visible })

  it('trusts the engine when the body is visible', () => {
    expect(bodyStatus(body(1.2, true))).toBe('visible')
    expect(bodyStatus(body(-0.5, true))).toBe('visible')
  })

  it('separates terrain blocking from being below the geometric horizon', () => {
    expect(bodyStatus(body(0.8, false))).toBe('terrain-blocked')
    expect(bodyStatus(body(-0.8, false))).toBe('below-horizon')
    expect(bodyStatus(body(-0.05, false), -0.087)).toBe('terrain-blocked')
  })
})

describe('panel helpers', () => {
  const tracking: PanelState = { mode: 'tracking', areaM2: 2, fixedNormalAzDeg: 0, fixedNormalElDeg: 0 }
  const fixedNorth: PanelState = { ...tracking, mode: 'fixed' }
  const sun = (azDeg: number, elDeg: number, visible = true): BodyState => ({ azDeg, elDeg, visible })

  it('points a tracking panel at the Sun (normal incidence)', () => {
    const s = sun(211, 1.4)
    close(cosIncidence(panelNormal(tracking, s), s), 1)
    expect(panelIsLit(tracking, s)).toBe(true)
  })

  it('uses the fixed normal and the cosine law for a fixed panel', () => {
    close(cosIncidence(panelNormal(fixedNorth, sun(60, 0)), sun(60, 0)), 0.5, 1e-9)
    close(cosIncidence(panelNormal(fixedNorth, sun(0, 0)), sun(0, 0)), 1)
  })

  it('gives zero for a back-lit fixed panel and for a hidden Sun', () => {
    close(cosIncidence(panelNormal(fixedNorth, sun(180, 0)), sun(180, 0)), 0)
    expect(panelIsLit(fixedNorth, sun(180, 0))).toBe(false)
    expect(panelIsLit(tracking, sun(30, 1, false))).toBe(false)
  })

  it('sizes the representative panel to the requested area', () => {
    const { widthM, heightM } = panelSize(2)
    close(widthM * heightM, 2)
    close(widthM / heightM, 1.6)
  })
})
