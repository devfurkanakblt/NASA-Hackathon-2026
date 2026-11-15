import { useEffect, useMemo, useState } from 'react'
import type { EphemerisDoc, Psr, SiteData } from '../data/contract.ts'
import { betterDatesFor, scanStartDates } from '../sim/betterDates.ts'
import type { DateAdvice, StartWindow } from '../sim/betterDates.ts'
import { evaluateScenario } from '../sim/evaluate.ts'
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { MAX_ALTERNATIVE_SLOPE_DEG, RESEARCH_TYPES, alternativesFor, researchMetrics } from '../sim/research.ts'
import type { Fit, ResearchMetrics, ResearchType } from '../sim/research.ts'
import type { Loadable, Resolved } from './extendedSites.ts'
import { fmtUtc } from './format.ts'
import { placeTitle } from './placeName.ts'
import { runResearchLocations } from '../sim/researchLocationsClient.ts'
import type { RankedResearchLocation, ResearchLocationsInput, ResearchLocationsResult } from '../sim/researchLocations.ts'

const FIT_LABEL: Record<Fit, string> = { strong: 'Good fit', possible: 'Possible', no: 'Not suited' }
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`)
const TAG_LABEL: Record<StartWindow['tags'][number], string> = { earlier: 'nearest earlier', later: 'nearest later', best: 'best in the period' }
/** "2026-11-18 06:00 – 2026-11-22 18:00 UTC", or one instant when the window is a single start. */
const fmtRange = (w: { firstUtc: string; lastUtc: string }) =>
  w.firstUtc === w.lastUtc ? fmtUtc(w.firstUtc) : `${fmtUtc(w.firstUtc).replace(' UTC', '')} – ${fmtUtc(w.lastUtc)}`

/**
 * Suitable research at the chosen place, with per-type southern-hemisphere rankings
 * for the same dates and hardware. Catalogue fallbacks remain for unsuitable types.
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
      // A south-polar place only gets south-polar alternatives (alternativesFor), and only
      // those places' one-year series are fetched, so the others are not waited for.
      if (selected.region === 'polar' && catalogue[id].site.category === 'contrast') continue
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
  }, [catalogue, resolveCatalogue, startUtc, settings, psrs, selected.region])

  const assessed = RESEARCH_TYPES.map((type) => ({ type, ...type.assess(selected) }))
  const suited = assessed.filter((a) => a.fit !== 'no')
  const typeKey = suited.map(a => a.type.id).join(',')
  const [attempt, setAttempt] = useState(0)
  const [paused, setPaused] = useState(false)
  const typeIds = useMemo(() => (typeKey ? typeKey.split(',') as ResearchType['id'][] : []), [typeKey])
  const searchInput = useMemo<ResearchLocationsInput>(() => ({
    reference: catalogue.Site01, catalogue: Object.values(catalogue), selected, psrs, startUtc, settings,
    typeIds,
  }), [catalogue, selected, psrs, startUtc, settings, typeIds])
  const [searchState, setSearchState] = useState<{ input: ResearchLocationsInput; result?: ResearchLocationsResult; progress?: string; error?: string } | null>(null)
  const currentSearch = searchState?.input === searchInput ? searchState : null
  const globalResult = currentSearch?.result
  useEffect(() => {
    if (paused || !searchInput.typeIds.length) return
    const controller = new AbortController()
    runResearchLocations(searchInput, { signal: controller.signal, onProgress: (done, planned) => {
      if (!controller.signal.aborted) setSearchState({ input: searchInput, progress: `${done} / ${planned} locations in the current stage` })
    } }).then(result => {
      if (!controller.signal.aborted) setSearchState({ input: searchInput, result })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSearchState({ input: searchInput, error: error instanceof Error ? error.message : String(error) })
    })
    return () => controller.abort()
  }, [searchInput, attempt, paused])

  return (
    <div className="research">
      {selected.slopeDeg !== null && selected.slopeDeg > MAX_ALTERNATIVE_SLOPE_DEG && (
        <p className="research__warning">Slope here is {selected.slopeDeg.toFixed(0)}°: above the app’s {MAX_ALTERNATIVE_SLOPE_DEG}° alternative-site threshold. This is not a landing-safety assessment.</p>
      )}
      <p className="research__summary">
        {suited.length ? <>Suited for: {suited.map((a) => a.type.title).join(' · ')}.</> : 'No research type below is suited here for this mission.'}
      </p>
      {suited.length > 0 && <div className="research__search">
        <h3>Best places for each research type</h3>
        <p className="small muted">Each suitable research type below has its own southern-hemisphere ranking for this mission. Research merit and hardware feasibility are shown separately.</p>
        {globalResult ? <>
          <p className="small" role="status">Compared {globalResult.testedLocations} locations. {globalResult.skippedCatalogue > 0 ? `${globalResult.skippedCatalogue} catalogue locations lacked usable data.` : ''}</p>
          <details className="small muted"><summary>Search coverage and limits</summary>{globalResult.notes.map(note => <p key={note}>{note}</p>)}</details>
        </> : currentSearch?.error ? <p role="alert" className="bad">Could not compare research locations: {currentSearch.error}</p>
          : <p role="status">{paused ? 'Surface search paused.' : currentSearch?.progress ?? 'Searching the southern hemisphere for each suitable research type…'}</p>}
        {!globalResult && !paused && !currentSearch?.error && <button type="button" onClick={() => setPaused(true)}>Cancel research search</button>}
        {(paused || currentSearch?.error) && <button type="button" onClick={() => { setSearchState(null); setPaused(false); setAttempt(value => value + 1) }}>Retry research search</button>}
      </div>}

      {assessed.map(({ type, fit, value }) => {
        const alternatives = alternativesFor(type, selected, candidates)
        return (
          <section key={type.id} className={`research__type research__type--${fit}`} aria-label={type.title}>
            <header>
              <h3>{type.title}</h3>
              <span className={`research__fit research__fit--${fit}`}>{FIT_LABEL[fit]}</span>
            </header>
            <p className="research__value">{value}</p>
            <details className="small muted">
              <summary>Why this research? Criteria and source</summary>
              <p>{type.basis} <a href={type.source.url} target="_blank" rel="noreferrer">{type.source.label}</a>. {type.rule}</p>
            </details>
            {fit !== 'no' ? <BestResearchPlaces options={globalResult?.rankings[type.id] ?? []} completed={!!globalResult}
              catalogue={catalogue} inScenarios={inScenarios} canAdd={canAdd} onCompare={onCompare} /> : alternatives.length > 0 ? (
              <div className="research__alts">
                <span className="small">Better catalogue places for this:</span>
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

      {loading > 0 && <p role="status">Loading {loading} locations?</p>}
      {skipped > 0 && <p>{skipped} locations have no data for these dates.</p>}
      {year === 'loading' && <p role="status">Loading annual data?</p>}
      {year === 'error' && <p role="status">Annual data unavailable. Showing two months.</p>}
    </div>
  )
}

function BestResearchPlaces({ options, completed, catalogue, inScenarios, canAdd, onCompare }: {
  options: RankedResearchLocation[]; completed: boolean; catalogue: Record<string, SiteData>; inScenarios: string[]; canAdd: boolean; onCompare: (siteId: string) => void
}) {
  if (!completed) return <p className="small muted">Best locations will appear here when the surface search finishes.</p>
  if (!options.length) return <p className="small muted">No other tested location meets this research criterion. This does not rule out unsampled locations.</p>
  return <div className="research__alts">
    <h4>Best other locations among tested candidates</h4>
    <ol>
      {options.map(a => {
        const added = inScenarios.includes(a.metrics.siteId)
        const name = catalogue[a.metrics.siteId] ? placeTitle(a.metrics.siteId, catalogue)
          : `${Math.abs(a.metrics.latDeg).toFixed(3)}° S, ${Math.abs(a.metrics.lonDeg).toFixed(3)}° ${a.metrics.lonDeg < 0 ? 'W' : 'E'}`
        return <li key={a.metrics.siteId}>
          <div>
            <strong>{name}</strong> · {FIT_LABEL[a.fit]} · {fmtKm(a.distanceKm)} away
            <p>{a.value}</p>
            <p className="small">{a.comparison === 'better' ? 'Better than the selected point on this criterion.' : a.comparison === 'equal' ? 'Matches the selected point on this criterion.' : 'The selected point ranks higher on this criterion.'}</p>
            <p className="small muted">{a.precisionLabel}. {a.metrics.slopeDeg === null ? 'Local slope is unverified.' : `Local slope ${a.metrics.slopeDeg.toFixed(1)}°.`}</p>
            <p className={`small${a.failures.length ? ' bad' : ''}`}>{a.failures.length ? `Hardware limits not met: ${a.failures.map(f => f.message).join(' ')}` : 'Battery reserve, energy supply and Earth outage limits met.'}</p>
          </div>
          <button type="button" disabled={added} onClick={() => onCompare(a.metrics.siteId)}>{added ? 'In comparison' : canAdd ? 'Add to compare' : 'Use instead'}</button>
        </li>
      })}
    </ol>
  </div>
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
