import { useEffect, useState } from 'react'
import { loadGlobalTerrain } from '../data/load.ts'
import type { GlobalTerrain } from './globalTerrain.ts'

export function useGlobalTerrain() {
  const [state, setState] = useState<{ terrain: GlobalTerrain | null; error: string | null }>({ terrain: null, error: null })
  useEffect(() => {
    let cancelled = false
    void loadGlobalTerrain().then(terrain => { if (!cancelled) setState({ terrain, error: null }) }, error => { if (!cancelled) setState({ terrain: null, error: String(error) }) })
    return () => { cancelled = true }
  }, [])
  return state
}

