import { useId, useMemo } from 'react'
import { ticks, useWidth } from './useWidth.ts'

export interface Series {
  label: string
  color: string
  values: ArrayLike<number>
  dashed?: boolean
  /** Draw values below this boundary dashed, and values above it solid. */
  dashedBelow?: number
}

export interface Marker {
  index: number
  value: number
  color: string
  label: string
}

interface Props {
  series: Series[]
  /** Hours between samples. */
  stepH: number
  yMin: number
  yMax: number
  yUnit: string
  /** Horizontal reference lines (e.g. battery reserve). */
  refLines?: { value: number; label: string }[]
  markers?: Marker[]
  /** Time cursor (sample index). */
  k: number
  height?: number
  ariaLabel: string
}

const PAD = { left: 52, right: 12, top: 12, bottom: 28 }

/** Simple time-series chart over mission hours (T+), in inline SVG. */
export function LineChart({ series, stepH, yMin, yMax, yUnit, refLines = [], markers = [], k, height = 220, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const clipId = useId()
  const n = Math.max(0, ...series.map((s) => s.values.length))
  const hours = Math.max(stepH, (n - 1) * stepH)
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + ((i * stepH) / hours) * plotW
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * plotH

  const paths = useMemo(
    () =>
      series.map((s) => {
        // At most ~2 points per pixel.
        const stride = Math.max(1, Math.floor(s.values.length / (plotW * 2)))
        let d = ''
        for (let i = 0; i < s.values.length; i += stride) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`
        const last = s.values.length - 1
        if (last > 0 && last % stride !== 0) d += `L${x(last).toFixed(1)},${y(s.values[last]).toFixed(1)}`
        return d
      }),
    [series, width, yMin, yMax], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const xTicks = ticks(0, hours, Math.max(3, Math.floor(plotW / 90)))
  const yTicks = ticks(yMin, yMax, 5)
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {yTicks.map((v) => (
          <g key={`y${v}`} className="axis">
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
              {v}
              {yUnit}
            </text>
          </g>
        ))}
        {xTicks.map((h) => (
          <g key={`x${h}`} className="axis">
            <line x1={x(h / stepH)} x2={x(h / stepH)} y1={PAD.top} y2={PAD.top + plotH} className="grid" />
            <text x={x(h / stepH)} y={height - 8} textAnchor="middle">
              T+{h} h
            </text>
          </g>
        ))}
        {refLines.map((r) => (
          <g key={r.label} className="chart__ref">
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(r.value)} y2={y(r.value)} />
            <text x={PAD.left + 4} y={y(r.value) - 4}>
              {r.label}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          if (s.dashedBelow === undefined) return (
            <path key={s.label} d={paths[i]} className="chart__line" stroke={s.color} strokeDasharray={s.dashed ? '5 4' : undefined} />
          )
          const boundary = Math.max(PAD.top, Math.min(PAD.top + plotH, y(s.dashedBelow)))
          return <g key={s.label}>
            <defs>
              <clipPath id={`${clipId}-${i}-above`}><rect x={PAD.left} y={PAD.top} width={Math.max(0, plotW)} height={boundary - PAD.top} /></clipPath>
              <clipPath id={`${clipId}-${i}-below`}><rect x={PAD.left} y={boundary} width={Math.max(0, plotW)} height={PAD.top + plotH - boundary} /></clipPath>
            </defs>
            <path d={paths[i]} className="chart__line" stroke={s.color} clipPath={`url(#${clipId}-${i}-above)`} />
            <path d={paths[i]} className="chart__line" stroke={s.color} strokeDasharray="5 4" clipPath={`url(#${clipId}-${i}-below)`} />
          </g>
        })}
        {markers.map((m) => (
          <g key={m.label} className="chart__marker">
            <circle cx={x(m.index)} cy={y(m.value)} r={4.5} stroke={m.color} />
            <text x={x(m.index) > PAD.left + plotW * 0.6 ? x(m.index) - 7 : x(m.index) + 7} y={y(m.value) + 14} fill={m.color} textAnchor={x(m.index) > PAD.left + plotW * 0.6 ? 'end' : 'start'}>
              {m.label}
            </text>
          </g>
        ))}
        <line x1={x(k)} x2={x(k)} y1={PAD.top} y2={PAD.top + plotH} className="chart__cursor" />
      </svg>
      <div className="chart__legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} className={s.dashed ? 'dashed' : undefined} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
