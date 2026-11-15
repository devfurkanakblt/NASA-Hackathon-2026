/**
 * How far Earth wanders in the local sky during a mission (libration).
 *
 * Seen from the Moon, Earth would hang still if the Moon's spin matched its orbit exactly. It does
 * not quite: the orbit is elliptical and the spin axis is tilted to it, so the Moon appears to rock
 * by up to ~8° in longitude and ~7° in latitude. From the surface Earth therefore traces a small
 * loop in the sky about once a month (27.3 days). The ephemeris already contains this motion (JPL
 * Horizons / DE421, observer on the surface); this module only measures it for the explanation.
 */

export type EarthLoop = 'always-up' | 'never-up' | 'crosses-horizon'

export interface EarthWobble {
  /** Azimuth span covered during the mission, degrees (wrap-around safe). */
  azSpanDeg: number
  /** Elevation above the local horizontal plane (no terrain): lowest and highest, degrees. */
  elMinDeg: number
  elMaxDeg: number
  /** Where the loop sits relative to the flat horizon (terrain is ignored here). */
  loop: EarthLoop
}

/** Smallest arc that contains every azimuth (handles the 359° → 0° wrap). */
function azimuthSpan(azDeg: ArrayLike<number>): number {
  const n = azDeg.length
  if (n < 2) return 0
  const sorted = Array.from(azDeg, (a) => ((a % 360) + 360) % 360).sort((a, b) => a - b)
  // The span is 360° minus the largest empty gap between neighbouring azimuths.
  let gap = sorted[0] + 360 - sorted[n - 1]
  for (let i = 1; i < n; i++) gap = Math.max(gap, sorted[i] - sorted[i - 1])
  return 360 - gap
}

export function earthWobble(azDeg: ArrayLike<number>, elDeg: ArrayLike<number>): EarthWobble | null {
  if (azDeg.length === 0 || elDeg.length === 0) return null
  let elMinDeg = Infinity
  let elMaxDeg = -Infinity
  for (let i = 0; i < elDeg.length; i++) {
    elMinDeg = Math.min(elMinDeg, elDeg[i])
    elMaxDeg = Math.max(elMaxDeg, elDeg[i])
  }
  const loop: EarthLoop = elMinDeg > 0 ? 'always-up' : elMaxDeg <= 0 ? 'never-up' : 'crosses-horizon'
  return { azSpanDeg: azimuthSpan(azDeg), elMinDeg, elMaxDeg, loop }
}
