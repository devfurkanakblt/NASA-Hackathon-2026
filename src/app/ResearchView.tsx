import { useMemo } from 'react'
import type { EphemerisDoc, Psr, SiteData } from '../data/contract.ts'
import { betterDatesFor, scanStartDates } from '../sim/betterDates.ts'
import type { DateAdvice, StartWindow } from '../sim/betterDates.ts'
import { evaluateScenario } from '../sim/evaluate.ts'
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { MAX_ALTERNATIVE_SLOPE_DEG, RESEARCH_TYPES, alternativesFor, researchMetrics } from '../sim/research.ts'
import type { Fit, ResearchMetrics } from '../sim/research.ts'
import type { Loadable, Resolved } from './extendedSites.ts'
import { fmtUtc } from './format.ts'
import { placeTitle } from './placeName.ts'

const FIT_LABEL: Record<Fit, string> = { strong: 'Good fit', possible: 'Possible', no: 'Not suited' }
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`)
const TAG_LABEL: Record<StartWindow['tags'][number], string> = { earlier: 'nearest earlier', later: 'nearest later', best: 'best in the period' }
/** "2026-11-18 06:00 – 2026-11-22 18:00 UTC", or one instant when the window is a single start. */
const fmtRange = (w: { firstUtc: string; lastUtc: string }) =>
  w.firstUtc === w.lastUtc ? fmtUtc(w.firstUtc) : `${fmtUtc(w.firstUtc).replace(' UTC', '')} – ${fmtUtc(w.lastUtc)}`

/**
 * Research the chosen place suits, measured for this mission, and the best other catalogue
 * places for the same research with the same dates and hardware.
 */
export function ResearchView({ data, result, startUtc, settings, catalogue, resolveCatalogue, psrs, inScenarios, canAdd, onCompare, year, chosenDates, onUseDate }: {
  data: SiteData
  result: ScenarioResult
  startUtc: string
  settings: MissionSettings
  /** Catalogue sites (not map points) the alternatives are chosen from. */
  catalogue: Record<string, SiteData>
  /** Data a catalogue place runs on for a start date: its one-year series past the two-month period. */
  resolveCatalogue: (siteId: string, startUtc: string) => Resolved
  psrs: Psr[]
  /** Site ids already in the comparison. */
  inScenarios: string[]
  canAdd: boolean
  onCompare: (siteId: string) => void
  /** One-year series of this catalogue place (null for a map point, which already runs on it). */
  year: Loadable<EphemerisDoc> | null
  /** Start dates of the scenarios already at this place. */
  chosenDates: string[]
  onUseDate: (startUtc: string) => void
}) {
  const selected = useMemo(() => researchMetrics(data, result, psrs), [data, result, psrs])
  // Other start dates at this place: the one-year series once loaded, else the place's own series.
  const yearLoaded = year !== null && year !== 'loading' && year !== 'error'
  const scanSeries = yearLoaded ? year : data.ephemeris
  const dateCandidates = useMemo(() => scanStartDates(scanSeries, data.horizon, selected, result.durationS),
    [scanSeries, data.horizon, selected, result.durationS])
  // Every catalogue place for the same mission dates and hardware, on the same data the
  // scenarios use (the one-year series past the two-month period). Places whose one-year
  // series is still loading are counted; those that cannot run these dates are skipped.
  const { candidates, skipped, loading } = useMemo(() => {
    const out: ResearchMetrics[] = []
    let missing = 0
    let waiting = 0
    for (const id of Object.keys(catalogue)) {
      const resolved = resolveCatalogue(id, startUtc)
      if ('loading' in resolved) { waiting++; continue }
      if ('error' in resolved) { missing++; continue }
      try {
        out.push(researchMetrics(resolved.data, evaluateScenario(resolved.data, startUtc, settings), psrs))
      } catch {
        missing++
      }
    }
    return { candidates: out, skipped: missing, loading: waiting }
  }, [catalogue, resolveCatalogue, startUtc, settings, psrs])

  const assessed = RESEARCH_TYPES.map((type) => ({ type, ...type.assess(selected) }))
  const suited = assessed.filter((a) => a.fit !== 'no')

  return (
    <div className="research">
      <p className="explain">
        What can be done at <strong>{placeTitle(data.site.id, catalogue)}</strong> during this mission, measured from NASA data.
        Each research type is a criterion NASA itself uses; the alternatives use the same dates and lander.
      </p>
      {selected.slopeDeg !== null && selected.slopeDeg > MAX_ALTERNATIVE_SLOPE_DEG && (
        <p className="research__warning">Slope here is {selected.slopeDeg.toFixed(0)}°: too steep for a safe landing, whatever the research.</p>
      )}
      <p className="research__summary">
        {suited.length ? <>Suited for: {suited.map((a) => a.type.title).join(' · ')}.</> : 'No research type below is suited here for this mission.'}
      </p>

      {assessed.map(({ type, fit, value }) => {
        const alternatives = alternativesFor(type, selected, candidates)
        return (
          <section key={type.id} className={`research__type research__type--${fit}`} aria-label={type.title}>
            <header>
              <h3>{type.title}</h3>
              <span className={`research__fit research__fit--${fit}`}>{FIT_LABEL[fit]}</span>
            </header>
            <p className="research__value">{value}</p>
            <p className="small muted">
              {type.basis} <a href={type.source.url} target="_blank" rel="noreferrer">{type.source.label}</a>. {type.rule}
            </p>
            {alternatives.length > 0 ? (
              <div className="research__alts">
                <span className="small">{fit === 'strong' ? 'Also good for this:' : 'Better places for this:'}</span>
                <ul>
                  {alternatives.map((a) => {
                    const added = inScenarios.includes(a.metrics.siteId)
                    return (
                      <li key={a.metrics.siteId}>
                        <span>
                          <strong>{placeTitle(a.metrics.siteId, catalogue)}</strong> · {FIT_LABEL[a.fit].toLowerCase()} · {a.value} · {fmtKm(a.distanceKm)} away
                        </span>
                        <button type="button" disabled={added} onClick={() => onCompare(a.metrics.siteId)}
                          title={added ? 'Already in the comparison' : canAdd ? 'Add to the comparison' : 'Replace the chosen place with this one'}>
                          {added ? 'In comparison' : canAdd ? 'Add to compare' : 'Use instead'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p className="small muted">No other catalogue place fits this research better for these dates.</p>
            )}
            {type.dependsOnDate && (
              <OtherDates advice={betterDatesFor(type, dateCandidates, startUtc, selected)} chosenDates={chosenDates}
                canAdd={canAdd} onUseDate={onUseDate} />
            )}
          </section>
        )
      })}

      <p className="small muted">
        Alternatives: catalogue places with a known slope of at most {MAX_ALTERNATIVE_SLOPE_DEG}° (app assumption), evaluated for the same
        start date, duration and lander. PSRs: NASA Moon Trek layer PSR_SP (PSRs of 10 km² or more; smaller PSRs can be closer).
        {loading > 0 && ` Loading the one-year data of ${loading} more place(s) for these dates; they join the alternatives when ready.`}
        {skipped > 0 && ` ${skipped} place(s) skipped: their data does not cover this mission (pre-computed period 1 Nov 2026 – 1 Nov 2027).`}
      </p>
      <p className="small muted">
        Other start dates: every start 6 hours apart{dateCandidates.length > 0 && ` from ${fmtUtc(dateCandidates[0].startUtc)} to ${fmtUtc(dateCandidates.at(-1)!.startUtc)}`},
        same place, duration and lander; JPL Horizons positions against the LOLA terrain horizon.
        A start window is a run of starts that all reach the same fit: any start inside it works.
        {year === 'loading' && ' The one-year series is still loading, so only the two-month period is scanned for now.'}
        {year === 'error' && ' The one-year series could not be loaded, so only the two-month period is scanned.'}
      </p>
    </div>
  )
}

/** Start windows at the same place for one research type, with buttons to try a date. */
function OtherDates({ advice, chosenDates, canAdd, onUseDate }: { advice: DateAdvice; chosenDates: string[]; canAdd: boolean; onUseDate: (startUtc: string) => void }) {
  const chosen = new Set(chosenDates.map((d) => Date.parse(d)))
  if (!advice.fit) return <p className="small muted research__dates">No start date in the scanned period fits this here.</p>
  const fitLabel = FIT_LABEL[advice.fit].toLowerCase()
  return (
    <div className="research__alts research__dates">
      <span className="small">Other start dates here ({advice.windowCount} {fitLabel} start window{advice.windowCount === 1 ? '' : 's'} in the period):</span>
      {advice.current && (
        <p className="small research__current">
          {advice.current.firstUtc === advice.fromUtc && advice.current.lastUtc === advice.toUtc
            ? <>Every start in the period is a {fitLabel}.</>
            : <>Your start is already inside a {fitLabel} window: any start in {fmtRange(advice.current)} works.</>}
        </p>
      )}
      {advice.options.length > 0 && (
        <ul>
          {advice.options.map((w) => {
            const added = chosen.has(Date.parse(w.best.startUtc))
            return (
              <li key={w.firstUtc}>
                <span>
                  <strong>{fmtRange(w)}</strong> · {w.tags.map((t) => TAG_LABEL[t]).join(', ')} · best start {fmtUtc(w.best.startUtc)}: {w.value}
                </span>
                <button type="button" disabled={added} onClick={() => onUseDate(w.best.startUtc)}
                  title={added ? 'This date is already in the comparison' : canAdd ? 'Add this place with this start date to the comparison' : 'Change the chosen scenario to this start date'}>
                  {added ? 'In comparison' : canAdd ? 'Add this date' : 'Use this date'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
