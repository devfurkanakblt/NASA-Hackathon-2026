import { useEffect, useState } from 'react'
import { loadDetailTerrain, loadGlobalTerrain } from '../data/load.ts'
import type { GlobalTerrain } from './globalTerrain.ts'

/** Whole-Moon display heights (small grid) for the place-picker globe. */
export function useGlobalTerrain() {
  const [state, setState] = useState<{ terrain: GlobalTerrain | null; error: string | null }>({ terrain: null, error: null })
  useEffect(() => {
    let cancelled = false
    void loadGlobalTerrain().then(terrain => { if (!cancelled) setState({ terrain, error: null }) }, error => { if (!cancelled) setState({ terrain: null, error: String(error) }) })
    return () => { cancelled = true }
  }, [])
  return state
}

/** Full-resolution heights around one point (only the tiles that cover `rangeM`). */
export function useDetailTerrain(latDeg: number, lonDeg: number, rangeM: number) {
  const key = `${latDeg}:${lonDeg}:${rangeM}`
  const [state, setState] = useState<{ key: string; terrain: GlobalTerrain | null; error: string | null }>({ key, terrain: null, error: null })
  useEffect(() => {
    let cancelled = false
    void loadDetailTerrain(latDeg, lonDeg, rangeM).then(
      terrain => { if (!cancelled) setState({ key, terrain, error: null }) },
      error => { if (!cancelled) setState({ key, terrain: null, error: String(error) }) })
    return () => { cancelled = true }
  }, [key, latDeg, lonDeg, rangeM])
  return state.key === key ? state : { terrain: null, error: null }
}
