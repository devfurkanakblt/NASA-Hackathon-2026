import type { ReactNode } from 'react'
import type { SiteData } from '../data/contract.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { fmtHours, fmtKWh, fmtPct, fmtUtc } from './format.ts'
import { earthVerdict, powerVerdict } from './plain.ts'
import type { Verdict } from './plain.ts'
import { mapPointWhere, placeTitle } from './placeName.ts'
import { elevationStats, isEvaluated } from './scenarios.ts'
import type { ScenarioOutcome } from './scenarios.ts'

interface Props {
  outcomes: ScenarioOutcome[]
  settings: MissionSettings
  bySite: Record<string, SiteData>
  colors: string[]
}

function Check({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`pill ${ok ? 'pill--ok' : 'pill--bad'}`}>{ok ? `✓ ${yes}` : `✗ ${no}`}</span>
}

/** Degrees above the local horizontal, one decimal. */
const fmtDeg = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(1)}°`)

/** "15 Nov 2026" (UTC). */
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Answer({ question, verdict }: { question: string; verdict: Verdict }) {
  return (
    <div aria-label={question} className={`answer ${verdict.ok ? 'answer--ok' : 'answer--bad'}`}>
      <span className="answer__icon" aria-hidden>
        {verdict.ok ? '✓' : '✗'}
      </span>
      <div>
        <b className="answer__title">{verdict.title}</b>
        <span className="answer__detail">{verdict.detail}</span>
      </div>
    </div>
  )
}

function Meter({ label, fraction, kind }: { label: string; fraction: number; kind: 'sun' | 'earth' }) {
  return (
    <div className={`meter meter--${kind}`}>
      <span className="meter__label">{label}</span>
      <span className="meter__bar" aria-hidden>
        <i style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      </span>
      <span className="meter__value">{fmtPct(fraction)}</span>
    </div>
  )
}

/**
 * Side-by-side comparison with the same hardware. It states the two conditions plainly
 * (battery reserve kept, Earth outage within the accepted limit) — there is no hidden score.
 */
export function Comparison({ outcomes, settings, bySite, colors }: Props) {
  const ok = outcomes.filter(isEvaluated)
  const shortestOutage = ok.length > 1 ? Math.min(...ok.map((o) => o.result.summary.longestEarthOutageS)) : null
  const reserve = `${Math.round(settings.reserveFraction * 100)} %`

  const rows: { label: string; cell: (o: (typeof ok)[number]) => ReactNode }[] = [
    { label: 'Site', cell: (o) => <span title={bySite[o.scenario.siteId]?.site.name}>{o.scenario.siteId}</span> },
    { label: 'Start', cell: (o) => fmtUtc(o.result.alignedStartUtc) },
    {
      label: 'Battery reserve',
      cell: (o) =>
        o.result.summary.keepsBatteryReserve ? (
          <Check ok yes={`kept (lowest ${fmtPct(o.result.summary.minSocFraction)})`} no="" />
        ) : (
          <Check ok={false} yes="" no={`below ${reserve} after ${fmtHours(o.result.summary.firstReserveViolationS ?? 0)}`} />
        ),
    },
    { label: 'Unmet demand', cell: (o) => <span className={o.result.summary.unmetEnergyJ > 0 ? 'bad' : undefined}>{o.result.summary.unmetEnergyJ > 0 ? fmtKWh(o.result.summary.unmetEnergyJ) : '0'}</span> },
    {
      label: 'Longest Earth outage',
      cell: (o) => (
        <>
          <Check ok={o.result.summary.earthOutageWithinLimit} yes={fmtHours(o.result.summary.longestEarthOutageS)} no={fmtHours(o.result.summary.longestEarthOutageS)} />
          {shortestOutage !== null && o.result.summary.longestEarthOutageS === shortestOutage && <span className="tag">shortest</span>}
        </>
      ),
    },
    { label: 'Sun elevation · highest', cell: (o) => fmtDeg(elevationStats(o, 'sun')?.maxDeg) },
    { label: 'Sun elevation · average', cell: (o) => fmtDeg(elevationStats(o, 'sun')?.meanDeg) },
    { label: 'Earth elevation · highest', cell: (o) => fmtDeg(elevationStats(o, 'earth')?.maxDeg) },
    { label: 'Sun in view', cell: (o) => fmtPct(o.result.summary.sunVisibleFraction) },
    { label: 'Earth in view', cell: (o) => fmtPct(o.result.summary.earthVisibleFraction) },
    { label: 'Both in view', cell: (o) => fmtPct(o.result.summary.bothVisibleFraction) },
    { label: 'Energy generated / demand', cell: (o) => `${fmtKWh(o.result.summary.energyGeneratedJ)} / ${fmtKWh(o.result.summary.energyDemandJ)}` },
    { label: 'Battery at the end', cell: (o) => fmtPct(o.result.summary.finalSocFraction) },
  ]

  return (
    <div className="comparison">
      <div className="results">
        {outcomes.map((o, i) => (
          <article key={o.scenario.key} className="result" style={{ borderColor: colors[i] }}>
            <header className="result__head">
              <span className="result__letter" style={{ background: colors[i] }}>
                {o.letter}
              </span>
              <div>
                <b>{placeTitle(o.scenario.siteId, bySite)}</b>
                <span className="muted small">
                  {mapPointWhere(o.scenario.siteId, bySite) ? `${mapPointWhere(o.scenario.siteId, bySite)}, ` : ''}
                  {fmtDay(o.result?.alignedStartUtc ?? o.scenario.startUtc)}, {settings.durationDays} {settings.durationDays === 1 ? 'day' : 'days'}
                </span>
              </div>
            </header>
            {isEvaluated(o) ? (
              <>
                <Answer question="Power?" verdict={powerVerdict(o.result, settings)} />
                <Answer question="See Earth?" verdict={earthVerdict(o.result, settings)} />
                <div className="meters">
                  <Meter label="Sunlight" fraction={o.result.summary.sunVisibleFraction} kind="sun" />
                  <Meter label="Earth in view" fraction={o.result.summary.earthVisibleFraction} kind="earth" />
                </div>
                <p className="result__elevation small">
                  <b>Sun elevation</b> highest {fmtDeg(elevationStats(o, 'sun')?.maxDeg)}, average {fmtDeg(elevationStats(o, 'sun')?.meanDeg)}
                </p>
              </>
            ) : (
              <p className={o.loading ? 'muted small' : 'bad small'} role={o.loading ? 'status' : 'alert'}>
                {o.error}
              </p>
            )}
          </article>
        ))}
      </div>
      <details className="comparison__more">
        <summary>Detailed comparison</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              {outcomes.map((o, i) => (
                <th key={o.scenario.key} style={{ color: colors[i] }}>
                  Scenario {o.letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {outcomes.map((o) => (
                  <td key={o.scenario.key}>{isEvaluated(o) ? row.cell(o) : row.label === 'Site' ? o.scenario.siteId : <span className={o.loading ? 'muted' : 'bad'}>{row.label === 'Start' ? o.error : '—'}</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
    </div>
  )
}
