import { useEffect, useMemo, useRef, useState } from 'react'
import type { SiteData } from '../data/contract.ts'
import { loadCells, loadHeader, loadRefined, loadYear } from '../data/extended.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { FAILURE_TEXT, METRICS, latestSearch, metricValue } from '../sim/search.ts'
import type { FailureCode, SearchCandidate, SearchMetric, SearchResult } from '../sim/search.ts'
import { runSearch } from '../sim/searchClient.ts'
import { RESEARCH_TYPES } from '../sim/research.ts'
import type { Psr, ResearchType } from '../sim/research.ts'
import { parseCellId } from './extendedSites.ts'
import { errorMessage, fmtDuration, fmtPct, fmtUtc } from './format.ts'
import { placeTitle } from './placeName.ts'
import { datesRequest, placesRequest, type Loaders } from './searchInputs.ts'

type Mode = 'dates' | 'places'

interface Props {
  /** The place and start the search starts from (the chosen scenario). */
  place: { siteId: string; startUtc: string; data: SiteData } | null
  settings: MissionSettings
  /** Catalogue sites (the places search tests all of them). */
  bySite: Record<string, SiteData>
  /** Titles for result rows, including map points and free points. */
  titles: Record<string, SiteData>
  /** Adds a copy scenario at this place and start; existing scenarios are kept. */
  onAdd: (siteId: string, startUtc: string) => void
  /** South-pole PSR list, for the water-ice research goal. */
  psrs: Psr[]
}

const LOADERS: Loaders = { year: (id) => loadYear(id), header: (id) => loadHeader(id), cells: (id) => loadCells(id), refined: (id) => loadRefined(id) }
const SHOWN = 5

interface Done {
  key: string
  result: SearchResult
}

/** One line per reason, from the engine's own numbers. */
function reasons(c: SearchCandidate, settings: MissionSettings): string[] {
  const s = c.summary
  if (!s) return []
  return [
    s.keepsBatteryReserve ? `Battery stays above the ${Math.round(settings.reserveFraction * 100)} % reserve (lowest ${fmtPct(s.minSocFraction)})` : `Battery falls below the reserve`,
    s.earthVisibleFraction === 0 ? 'Earth not in view during the mission' : `Longest time without Earth: ${fmtDuration(s.longestEarthOutageS)} (limit ${fmtDuration(settings.maxEarthOutageH * 3600)})`,
    `Sun and Earth both in view ${fmtPct(s.bothVisibleFraction)} of the mission`,
  ]
}

/**
 * "Find a better date or place": D's search engine (Web Worker) for the chosen scenario, with
 * progress, cancel, plain reasons and the engine's limits. Results are copies added to the
 * comparison; a change of place, date, settings or metric invalidates an old answer.
 */
export function SearchPanel({ place, settings, bySite, titles, onAdd, psrs }: Props) {
  const [mode, setMode] = useState<Mode>('dates')
  const [metric, setMetric] = useState<SearchMetric>('minSoc')
  const [withMap, setWithMap] = useState(false)
  const [goalId, setGoalId] = useState<ResearchType['id'] | ''>('')
  const [running, setRunning] = useState<{ done: number; planned: number; phase: string } | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const run = useRef(latestSearch())
  const abort = useRef<AbortController | null>(null)

  const baseSite = place ? (parseCellId(place.siteId)?.siteId ?? place.siteId) : null
  const mapOf = baseSite && bySite[baseSite]?.map ? baseSite : null
  const key = useMemo(
    () => (place ? JSON.stringify([mode, place.siteId, mode === 'places' ? place.startUtc : '', settings, metric, mode === 'places' && withMap ? mapOf : null, goalId]) : ''),
    [mode, place, settings, metric, withMap, mapOf, goalId],
  )
  const current = done && done.key === key ? done.result : null
  const stale = done && done.key !== key

  // A new place, date, setting or metric cancels the running search.
  useEffect(() => () => abort.current?.abort(), [key])

  if (!place) return null

  const start = async () => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setError(null)
    setAdded([])
    const myKey = key
    setRunning({ done: 0, planned: 0, phase: 'Loading data…' })
    const goal = goalId ? { type: goalId, psrs } : null
    try {
      const request =
        mode === 'dates'
          ? await datesRequest(place.data, settings, metric, LOADERS, goal)
          : await placesRequest(place.startUtc, settings, metric, bySite, LOADERS, {
              mapOf: withMap ? mapOf : null,
              goal,
              onProgress: (d, t) => setRunning({ done: d, planned: t, phase: 'Loading data…' }),
            })
      if ('error' in request) throw new Error(request.error)
      if (ctl.signal.aborted) return
      setRunning({ done: 0, planned: 0, phase: 'Testing…' })
      // `latestSearch` drops an answer that a newer search has replaced; Cancel aborts this one.
      const result = await run.current((signal) =>
        runSearch(request, { signal: AbortSignal.any([signal, ctl.signal]), onProgress: (d, p) => setRunning({ done: d, planned: p, phase: 'Testing…' }) }),
      )
      if (result) setDone({ key: myKey, result })
    } catch (e) {
      if (!ctl.signal.aborted) setError(errorMessage(e))
    } finally {
      if (abort.current === ctl) {
        abort.current = null
        setRunning(null)
      }
    }
  }
  const cancel = () => abort.current?.abort()

  const title = (id: string) => placeTitle(id, titles)
  const rows = current ? current.feasible.slice(0, SHOWN) : []

  return (
    <section className="card search-panel" aria-labelledby="search-title">
      <div className="card__head">
        <div>
          <h2 id="search-title">Find a better date or place</h2>
          <p className="card__tagline">Same lander and {settings.durationDays}-day mission. Only options that keep the battery reserve and the Earth-view limit pass.</p>
        </div>
      </div>
      <div className="search-panel__modes" role="radiogroup" aria-label="What to search">
        <button type="button" role="radio" aria-checked={mode === 'dates'} className={mode === 'dates' ? 'is-on' : undefined} onClick={() => setMode('dates')}>
          Find dates for this place
        </button>
        <button type="button" role="radio" aria-checked={mode === 'places'} className={mode === 'places' ? 'is-on' : undefined} onClick={() => setMode('places')}>
          Find places for this date
        </button>
      </div>
      <p className="small muted">
        {mode === 'dates'
          ? <>Place fixed: <b>{title(place.siteId)}</b>. Every start in its data is tested (daily, then hourly and 10-minute steps around the best).</>
          : <>Start fixed: <b>{fmtUtc(place.startUtc)}</b>. Every catalogue site is tested{withMap && mapOf ? `, plus the map points around ${mapOf}` : ''}.</>}
      </p>
      <div className="search-panel__controls">
        <label>
          <span>Research goal (checked first)</span>
          <select value={goalId} onChange={(e) => setGoalId(e.target.value as ResearchType['id'] | '')}>
            <option value="">None: energy and Earth view only</option>
            {RESEARCH_TYPES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <label>
          <span>Rank passing options by</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value as SearchMetric)}>
            {(Object.keys(METRICS) as SearchMetric[]).map((m) => (
              <option key={m} value={m}>
                {METRICS[m].label} ({METRICS[m].better === 'higher' ? 'higher is better' : 'shorter is better'})
              </option>
            ))}
          </select>
        </label>
        {mode === 'places' && mapOf && (
          <label className="search-panel__check">
            <input type="checkbox" checked={withMap} onChange={(e) => setWithMap(e.target.checked)} />
            <span>Also test the ±3 km map points around {mapOf} (screening estimate)</span>
          </label>
        )}
        {running ? (
          <button type="button" onClick={cancel}>Cancel</button>
        ) : (
          <button type="button" className="primary" onClick={start}>Search</button>
        )}
      </div>

      {running && (
        <div className="search-panel__progress" role="status" aria-live="polite">
          <span>{running.phase} {running.planned > 0 ? `${running.done} / ${running.planned}` : ''}</span>
          <progress max={running.planned || 1} value={running.planned ? running.done : 0} />
        </div>
      )}
      {error && <p className="bad" role="alert">{error}</p>}
      {stale && !running && <p className="small muted">The place, date, settings or ranking changed since the last search. Search again for an up-to-date answer.</p>}

      {current && (
        <div className="search-panel__result" aria-live="polite">
          {current.status !== 'complete' && <p className="bad">{current.notes[0]}</p>}
          {current.best ? (
            <p className="search-panel__summary">
              <b>Best among the {current.tested} options tested</b> for “{METRICS[current.sortBy].label.toLowerCase()}”: {title(current.best.siteId)}, {fmtUtc(current.best.startUtc)}.
              {' '}{current.feasible.length} pass, {current.pareto.length} are not beaten on every measure by another.
              {(() => {
                const best = current.best!.metrics!
                const tied = current.feasible.filter((c) => c.metrics && metricValue(c.metrics, current.sortBy) === metricValue(best, current.sortBy)).length - 1
                return tied > 0 ? ` ${tied} other${tied === 1 ? '' : 's'} tie on this measure; they are ordered by the other measures (shorter time without Earth, higher lowest charge, more time with Sun and Earth).` : ''
              })()}
            </p>
          ) : current.status === 'complete' ? (
            <div>
              <p className="search-panel__summary"><b>No tested option meets every condition.</b> The limits were not relaxed.</p>
              <ul className="search-panel__fails">
                {Object.entries(current.failureCounts).map(([code, n]) => {
                  const example = current.rejected.find((c) => c.failures.some((f) => f.code === code))?.failures.find((f) => f.code === code)?.message
                  return <li key={code}>{FAILURE_TEXT[code as FailureCode]} ({n} of {current.tested}){example ? `: e.g. ${example}` : ''}</li>
                })}
              </ul>
            </div>
          ) : null}
          {rows.length > 0 && (
            <ol className="search-panel__list">
              {rows.map((c) => {
                const id = `${c.siteId}@${c.startUtc}`
                const isAdded = added.includes(id)
                return (
                  <li key={id}>
                    <div className="search-panel__row-head">
                      <b>{mode === 'dates' ? fmtUtc(c.startUtc) : title(c.siteId)}</b>
                      {mode === 'places' && <span className="muted small">{fmtUtc(c.startUtc)}</span>}
                      {c.pareto && <span className="search-panel__tag" title="No other passing option is better on every measure">not outdone</span>}
                      <button type="button" disabled={isAdded} onClick={() => { onAdd(c.siteId, c.startUtc); setAdded((a) => [...a, id]) }}>
                        {isAdded ? 'Added' : 'Add to comparison'}
                      </button>
                    </div>
                    {c.goalFit && <p className="small"><b>Research goal:</b> {c.goalFit.fit === 'strong' ? 'fits well' : 'fits partly'} ({c.goalFit.value})</p>}
                    <ul className="search-panel__reasons">
                      {reasons(c, settings).map((r) => <li key={r}>{r}</li>)}
                    </ul>
                    <p className="small muted">{c.precisionLabel}. Research suitability: {c.research.match === 'equivalent' ? 'same research confirmed' : 'not verified'}.</p>
                  </li>
                )
              })}
            </ol>
          )}
          <details className="search-panel__details">
            <summary>What was searched</summary>
            <ul className="small">
              <li>Range: {fmtUtc(current.searchedRange.fromUtc)} to {fmtUtc(current.searchedRange.toUtc)}</li>
              <li>Steps: {current.timeStep.coarseS ? `${fmtDuration(current.timeStep.coarseS)}, then ${current.timeStep.refineS.map((s) => fmtDuration(s)).join(' and ') || 'no refinement'}` : 'one start'}</li>
              <li>Places: {current.spatialCoverage.description}</li>
              <li>{current.tested} options tested, {current.feasible.length} passed, {current.tested - current.feasible.length} did not ({Object.entries(current.failureCounts).map(([k, n]) => `${FAILURE_TEXT[k as FailureCode]}: ${n}`).join('; ') || 'none'})</li>
              {current.notes.map((n) => <li key={n}>{n}</li>)}
              <li>Search took {(current.elapsedMs / 1000).toFixed(1)} s.</li>
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}
