import { useMemo } from 'react'
import type { SiteEntry } from '../data/contract.ts'
import { MissionScene3D } from './MissionScene3D.tsx'
import type { MissionScene3DProps } from './MissionScene3D.tsx'
import { useDetailTerrain } from './useGlobalTerrain.ts'
import { globalLocalTerrain } from './globalLocalTerrain.ts'

/** Registered 3D view for points without a local display package; scientific inputs pass through. */
export function GlobalPointScene({ site, ...scene }: Omit<MissionScene3DProps, 'terrain' | 'farTerrain'> & { site: SiteEntry }) {
  // The far grid reaches 250 km from the point: load only the full-resolution tiles around it.
  const { terrain, error } = useDetailTerrain(site.latDeg, site.lonDeg, 260000)
  const grids = useMemo(() => terrain ? {
    near: globalLocalTerrain(terrain, site, site.observerHeightM, 32000, 65),
    far: globalLocalTerrain(terrain, site, site.observerHeightM, 500000, 161),
  } : null, [terrain, site])
  return <>
    <p className="small muted" role="note">Global NASA LOLA display terrain (~1.9 km/px), centred on this point and aligned to its ground height. Small hills and crater walls are unresolved. Archive image shadows are not the selected UTC; turn off NASA imagery to inspect the selected Sun lighting. The calculated horizon remains the visibility authority.</p>
    <div className="scene-box scene-box--large">
      {grids ? <MissionScene3D {...scene} terrain={grids.near} farTerrain={grids.far} globalPhotoFrame={site} />
        : <p role="status">{error ? 'Global display terrain unavailable. Scientific results remain available.' : 'Preparing NASA LOLA point view…'}</p>}
    </div>
  </>
}
