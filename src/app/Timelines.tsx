import type { VisibilityWindow } from '../sim/visibility.ts'
import { fmtDuration } from './format.ts'
import type { EvaluatedOutcome } from './scenarios.ts'

interface Props {
  outcomes: EvaluatedOutcome[]
  colors: string[]
  /** Current sample. */
  k: number
}

function Strip({ windows, durationS, kind }: { windows: VisibilityWindow[]; durationS: number; kind: string }) {
  return (
    <div className={`strip strip--${kind}`}>
      {windows.map((w) => (
        <span
          key={w.startS}
          style={{ left: `${(100 * w.startS) / durationS}%`, width: `${Math.max(0.15, (100 * (w.endS - w.startS)) / durationS)}%` }}
          title={`${fmtDuration(w.startS)} → ${fmtDuration(w.endS)} (${fmtDuration(w.endS - w.startS)})`}
        />
      ))}
    </div>
  )
}

/** Sun / Earth / both in view over the mission, one block per scenario, on a shared time axis. */
export function Timelines({ outcomes, colors, k }: Props) {
  if (outcomes.length === 0) return null
  const durationS = outcomes[0].result.durationS
  const stepS = outcomes[0].result.stepS
  const days = Math.round(durationS / 86400)
  const dayTicks = Array.from({ length: days + 1 }, (_, d) => d).filter((d) => days <= 10 || d % Math.ceil(days / 10) === 0)
  const cursor = `${Math.min(100, (100 * k * stepS) / durationS)}%`
  return (
    <div className="timelines">
      {outcomes.map((o, i) => (
        <div className="timelines__block" key={o.scenario.key}>
          <div className="timelines__title">
            <b style={{ color: colors[i] }}>{o.letter}</b> {o.scenario.siteId}
          </div>
          {(
            [
              ['Sun', 'sun', o.result.sunWindows],
              ['Earth', 'earth', o.result.earthWindows],
              ['Both', 'both', o.result.bothWindows],
            ] as const
          ).map(([label, kind, windows]) => (
            <div className="timelines__row" key={kind}>
              <span className="timelines__label">{label}</span>
              <div className="timelines__track">
                <Strip windows={windows} durationS={durationS} kind={kind} />
                <i className="timelines__cursor" style={{ left: cursor }} />
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="timelines__row timelines__axis">
        <span className="timelines__label" />
        <div className="timelines__track">
          {dayTicks.map((d) => (
            <span key={d} style={{ left: `${(100 * d * 86400) / durationS}%` }}>
              T+{d} d
            </span>
          ))}
        </div>
      </div>
      <p className="muted small">Coloured = the body's centre is above the terrain horizon. Hover a block for its start, end and length.</p>
    </div>
  )
}
