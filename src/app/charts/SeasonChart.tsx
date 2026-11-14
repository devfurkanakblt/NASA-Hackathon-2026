import { useState } from 'react'
import type { SeasonDoc } from '../../data/contract.ts'
import { fmtDuration } from '../format.ts'
import { useWidth } from './useWidth.ts'

interface Props {
  season: SeasonDoc
  /** Start of the active scenario; its month is marked. */
  missionStartUtc?: string
}

const HEIGHT = 230
const PAD = { left: 44, right: 12, top: 14, bottom: 30 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SERIES = [
  { key: 'sunPct', label: 'Sun in view', color: 'var(--sun)' },
  { key: 'earthPct', label: 'Earth in view', color: 'var(--earth)' },
  { key: 'bothPct', label: 'Both in view', color: 'var(--ok)', dashed: true },
] as const

const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/**
 * One year of Sun / Earth visibility by calendar month (`season.json`): the seasonal effect at
 * the pole. The shaded months are the period the mission simulation covers.
 */
export function SeasonChart({ season, missionStartUtc }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const months = season.months
  const n = months.length
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const band = plotW / Math.max(1, n)
  const x = (i: number) => PAD.left + (i + 0.5) * band
  const y = (pct: number) => PAD.top + ((100 - pct) / 100) * plotH
  const simStart = season.mainPeriod.startUtc.slice(0, 7)
  const simEnd = season.mainPeriod.endUtc.slice(0, 7)
  const simMonths = months.map((m, i) => (m.month >= simStart && m.month < simEnd ? i : -1)).filter((i) => i >= 0)
  const missionIdx = missionStartUtc ? months.findIndex((m) => m.month === missionStartUtc.slice(0, 7)) : -1
  const tip = hover !== null ? months[hover] : null
  const yr = season.year

  return (
    <div className="chart season" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Sun, Earth and both in view per month at ${season.siteId}, ${months[0]?.month} to ${months[n - 1]?.month}`} onMouseLeave={() => setHover(null)}>
        {simMonths.length > 0 && (
          <g className="season__sim">
            <rect x={x(simMonths[0]) - band / 2} y={PAD.top} width={band * simMonths.length} height={plotH} />
            <text x={x(simMonths[0]) - band / 2 + 4} y={PAD.top + 12}>
              simulated period
            </text>
          </g>
        )}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v} className="axis">
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
              {v} %
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <g key={m.month} className="axis">
            <text x={x(i)} y={HEIGHT - 10} textAnchor="middle" className={i === missionIdx ? 'season__mission' : undefined}>
              {width < 520 ? MONTHS[Number(m.month.slice(5, 7)) - 1][0] : MONTHS[Number(m.month.slice(5, 7)) - 1]}
              {i === 0 || m.month.endsWith('-01') ? (width < 520 ? '' : ` ${m.month.slice(2, 4)}`) : ''}
            </text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="chart__cursor" />}
        {missionIdx >= 0 && <line x1={x(missionIdx)} x2={x(missionIdx)} y1={PAD.top} y2={PAD.top + plotH} className="season__mission-line" />}
        {SERIES.map((s) => (
          <g key={s.key}>
            <path d={months.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(m[s.key]).toFixed(1)}`).join('')} className="chart__line" stroke={s.color} strokeDasharray={'dashed' in s ? '5 4' : undefined} />
            {months.map((m, i) => (
              <circle key={m.month} cx={x(i)} cy={y(m[s.key])} r={hover === i ? 4.5 : 3} fill={s.color} className="season__dot" />
            ))}
          </g>
        ))}
        {months.map((m, i) => (
          <rect key={m.month} x={x(i) - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {tip && hover !== null && (
        <div className={`season__tip${x(hover) > width * 0.6 ? ' is-left' : ''}`} style={{ left: x(hover), top: PAD.top }}>
          <b>{monthName(tip.month)}</b>
          <br />
          Sun {tip.sunPct.toFixed(1)} % · Earth {tip.earthPct.toFixed(1)} % · both {tip.bothPct.toFixed(1)} %
          <br />
          <span className="muted">
            Sun max {tip.sunElMaxDeg.toFixed(1)}° above flat horizon · longest without Sun {tip.longestNoSunS === 0 ? '—' : fmtDuration(tip.longestNoSunS)}
          </span>
        </div>
      )}
      <div className="chart__legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} className={'dashed' in s ? 'dashed' : undefined} />
            {s.label}
          </span>
        ))}
        {missionIdx >= 0 && (
          <span>
            <i className="season__legend-mission" />
            month of the active mission start
          </span>
        )}
      </div>
      <p className="muted small">
        Year {months[0] && monthName(months[0].month)} – {months[n - 1] && monthName(months[n - 1].month)}: Sun {yr.sunPct.toFixed(0)} %, Earth {yr.earthPct.toFixed(0)} %, both{' '}
        {yr.bothPct.toFixed(0)} % of the time; longest without Sun {yr.longestNoSunS === 0 ? '—' : fmtDuration(yr.longestNoSunS)}. Monthly summaries from a one-year JPL Horizons run with the
        same terrain horizon; the mission simulation itself covers only the shaded months.
      </p>
      <details className="small">
        <summary>Table</summary>
        <div className="table-wrap">
          <table className="season__table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Sun</th>
                <th>Earth</th>
                <th>Both</th>
                <th>Sun max el.</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th>{monthName(m.month)}</th>
                  <td>{m.sunPct.toFixed(1)} %</td>
                  <td>{m.earthPct.toFixed(1)} %</td>
                  <td>{m.bothPct.toFixed(1)} %</td>
                  <td>{m.sunElMaxDeg.toFixed(2)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
