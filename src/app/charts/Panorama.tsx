import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { HorizonDoc } from '../../data/contract.ts'
import { horizonAt } from '../../sim/visibility.ts'
import { ticks, useWidth } from './useWidth.ts'

export interface Track {
  azDeg: ArrayLike<number>
  elDeg: ArrayLike<number>
  visible: ArrayLike<boolean>
}

interface Props {
  horizon: HorizonDoc
  sun: Track
  earth: Track
  /** Current sample in the tracks. */
  k: number
}

const HEIGHT = 300
const PAD = { left: 44, right: 12, top: 14, bottom: 30 }
const COMPASS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N' }

const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

/** Distance to the terrain that forms the horizon at an azimuth (nearest 0.1° sample). */
function ridgeDistanceM(horizon: HorizonDoc, azDeg: number): number {
  const i = Math.round((((azDeg % 360) + 360) % 360) / horizon.azStepDeg) % horizon.count
  return horizon.distanceM[i]
}

/**
 * Horizon panorama: the terrain skyline over all 360° of azimuth against the flat (0°) horizon,
 * with the Sun and Earth tracks of the mission. Solid track = centre above the terrain horizon
 * (same `horizonAt` test as the engine), dotted = hidden.
 */
export function Panorama({ horizon, sun, earth, k }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hoverAz, setHoverAz] = useState<number | null>(null)

  const { lo, hi } = useMemo(() => {
    let lo = -1
    let hi = 1
    for (const v of horizon.elevDeg) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const t of [sun, earth])
      for (let i = 0; i < t.elDeg.length; i++) {
        lo = Math.min(lo, t.elDeg[i])
        hi = Math.max(hi, t.elDeg[i])
      }
    return { lo: Math.max(-15, Math.floor(lo - 0.5)), hi: Math.min(90, Math.ceil(hi + 0.5)) }
  }, [horizon, sun, earth])

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (az: number) => PAD.left + (az / 360) * plotW
  const y = (el: number) => PAD.top + ((hi - el) / (hi - lo)) * plotH

  const terrainPath = useMemo(() => {
    const n = horizon.count
    let d = `M${x(0)},${y(lo)}`
    for (let i = 0; i <= n; i++) d += `L${x((i * 360) / n).toFixed(1)},${y(horizon.elevDeg[i % n]).toFixed(1)}`
    return `${d}L${x(360)},${y(lo)}Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, width, lo, hi])

  const trackPaths = (t: Track) => {
    let shown = ''
    let hidden = ''
    for (let i = 0; i + 1 < t.azDeg.length; i++) {
      const a0 = t.azDeg[i]
      const a1 = t.azDeg[i + 1]
      if (Math.abs(a1 - a0) > 180) continue // wraps 360° → 0°
      const seg = `M${x(a0).toFixed(1)},${y(t.elDeg[i]).toFixed(1)}L${x(a1).toFixed(1)},${y(t.elDeg[i + 1]).toFixed(1)}`
      if (t.visible[i] && t.visible[i + 1]) shown += seg
      else hidden += seg
    }
    return { shown, hidden }
  }
  const sunPaths = useMemo(() => trackPaths(sun), [sun, width, lo, hi]) // eslint-disable-line react-hooks/exhaustive-deps
  const earthPaths = useMemo(() => trackPaths(earth), [earth, width, lo, hi]) // eslint-disable-line react-hooks/exhaustive-deps

  const kk = Math.min(k, sun.azDeg.length - 1)
  const body = (t: Track, name: string) => {
    const az = t.azDeg[kk]
    const el = t.elDeg[kk]
    const h = horizonAt(horizon, az)
    const state = t.visible[kk] ? 'in view' : el > 0 ? 'hidden by terrain' : 'below the flat horizon'
    return { name, az, el, h, state, visible: t.visible[kk], dist: ridgeDistanceM(horizon, az) }
  }
  const sunNow = body(sun, 'Sun')
  const earthNow = body(earth, 'Earth')

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const az = ((e.clientX - rect.left - PAD.left) / plotW) * 360
    setHoverAz(az >= 0 && az <= 360 ? az : null)
  }

  const yTicks = ticks(lo, hi, 6)
  const marker = (b: typeof sunNow, cls: string, r: number) => (
    <g className={`pano__marker ${cls}${b.visible ? '' : ' is-hidden'}`}>
      <circle cx={x(b.az)} cy={y(b.el)} r={r} />
      <text x={x(b.az) + r + 4} y={y(b.el) - r - 2}>
        {b.name}
      </text>
    </g>
  )

  return (
    <div className="pano" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Horizon panorama with the Sun and Earth tracks" onPointerMove={onMove} onPointerLeave={() => setHoverAz(null)}>
        <defs>
          <clipPath id="pano-clip">
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {yTicks.map((v) => (
          <g key={v} className="axis">
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
              {v}°
            </text>
          </g>
        ))}
        {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((az) => (
          <g key={az} className="axis">
            <line x1={x(az)} x2={x(az)} y1={PAD.top} y2={PAD.top + plotH} className="grid" />
            <text x={x(az)} y={HEIGHT - 10} textAnchor="middle">
              {plotW < 520 ? COMPASS[az] : `${COMPASS[az]} ${az}°`}
            </text>
          </g>
        ))}
        <g clipPath="url(#pano-clip)">
          <path d={terrainPath} className="pano__terrain" />
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} className="pano__flat" />
          <path d={sunPaths.hidden} className="pano__track pano__track--sun is-hidden" />
          <path d={earthPaths.hidden} className="pano__track pano__track--earth is-hidden" />
          <path d={sunPaths.shown} className="pano__track pano__track--sun" />
          <path d={earthPaths.shown} className="pano__track pano__track--earth" />
          {marker(sunNow, 'pano__marker--sun', 6)}
          {marker(earthNow, 'pano__marker--earth', 5)}
          {hoverAz !== null && <line x1={x(hoverAz)} x2={x(hoverAz)} y1={PAD.top} y2={PAD.top + plotH} className="pano__hover" />}
        </g>
        <text x={PAD.left + plotW - 4} y={y(0) - 4} textAnchor="end" className="pano__flat-label">
          flat horizon 0°
        </text>
      </svg>
      <div className="chart__legend pano__legend">
        <span>
          <i style={{ background: 'var(--sun)' }} />
          Sun
        </span>
        <span>
          <i style={{ background: 'var(--earth)' }} />
          Earth
        </span>
        <span>
          <i className="dotted" />
          dotted: hidden behind the terrain
        </span>
        {hoverAz !== null && (
          <span className="pano__hover-read">
            {Math.round(hoverAz)}°: skyline {horizonAt(horizon, hoverAz).toFixed(1)}° high, {fmtKm(ridgeDistanceM(horizon, hoverAz))} away
          </span>
        )}
      </div>
    </div>
  )
}
