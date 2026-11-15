import type { GlobalTerrain } from './globalTerrain.ts'
import { globalHeightM } from './globalTerrain.ts'
import type { TerrainGrid } from './types.ts'
import type { GlobalPhotoFrame } from './GlobalMoonSurface.tsx'

/** C display adapter only. It never supplies a scientific horizon or energy input. */
export function globalLocalTerrain(data: GlobalTerrain, site: GlobalPhotoFrame, observerHeightM: number, sizeM: number, n: number): TerrainGrid {
  const R = data.referenceRadiusM, cellM = sizeM / n
  const lat = site.latDeg * Math.PI / 180, lon = site.lonDeg * Math.PI / 180
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  const east = [-Math.sin(lon), Math.cos(lon), 0]
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)]
  // A fine-map observer can differ from the coarse DEM: align only the display's vertical
  // datum at the observer, rather than moving the scientific observer or reusing a site's mesh.
  const centreM = globalHeightM(data, site.latDeg, site.lonDeg)
  const zM: number[] = []
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const e = (col + .5) * cellM - sizeM / 2, no = (row + .5) * cellM - sizeM / 2
    const rho = Math.hypot(e, no)
    let h = centreM, theta = 0
    // Orthographic ENU coordinates, including lunar curvature; solve the radial-height term.
    for (let k = 0; k < 4; k++) {
      theta = Math.asin(rho / (R + h))
      const q = up.map((v, i) => v * Math.cos(theta) + (rho ? (e * east[i] + no * north[i]) / rho * Math.sin(theta) : 0))
      h = globalHeightM(data, Math.asin(Math.max(-1, Math.min(1, q[2]))) * 180 / Math.PI, Math.atan2(q[1], q[0]) * 180 / Math.PI)
    }
    theta = Math.asin(rho / (R + h))
    zM.push((R + h) * Math.cos(theta) - R - centreM - observerHeightM)
  }
  return { n, sizeM, cellM, zM }
}
