import { useMemo } from 'react'
import type { HorizonDoc } from '../../data/contract.ts'
import { horizonAt } from '../../sim/visibility.ts'
import { LineChart } from './LineChart.tsx'
import type { Track } from './Panorama.tsx'

interface Props {
  horizon: HorizonDoc
  sun: Track
  earth: Track
  stepH: number
  k: number
}

/** Time replaces compass direction; zero is the actual terrain skyline in each body's direction. */
export function SkyVisibilityChart({ horizon, sun, earth, stepH, k }: Props) {
  const { series, extent } = useMemo(() => {
    const clearance = (track: Track) => Array.from(track.elDeg, (elevation, i) => elevation - horizonAt(horizon, track.azDeg[i]))
    const series = [
      { label: 'Sun', color: '#ffd166', values: clearance(sun), dashedBelow: 0 },
      { label: 'Earth', color: '#9db7ff', values: clearance(earth), dashedBelow: 0 },
    ]
    let extent = 1
    for (const line of series) for (const value of line.values) extent = Math.max(extent, Math.abs(value))
    return { series, extent: Math.ceil(extent * 1.1) }
  }, [horizon, sun, earth])

  return (
    <div className="sky-visibility">
      <p className="sky-visibility__axis">Solid: in view. Dashed: below the terrain skyline.</p>
      <LineChart
        series={series}
        stepH={stepH}
        yMin={-extent}
        yMax={extent}
        yUnit="°"
        refLines={[{ value: 0, label: 'Terrain skyline · visibility boundary' }]}
        k={k}
        height={320}
        ariaLabel="Sun and Earth visibility over mission time. Positive angles are in view; negative angles are hidden."
      />
    </div>
  )
}
