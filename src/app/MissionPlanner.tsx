import { useEffect, useRef, useState } from 'react'
import type { SiteData } from '../data/contract.ts'
import { loadYear } from '../data/extended.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { validateSettings } from '../sim/evaluate.ts'
import { runSearch } from '../sim/searchClient.ts'
import { METRICS, type SearchCandidate, type SearchMetric, type SearchResult } from '../sim/search.ts'
import { fmtLatLon, fmtUtc } from './format.ts'
import { parseFreePointId } from '../sim/freePoint.ts'
import { REGION_LABEL, type SearchRegion } from '../sim/hemisphere.ts'
import { plannerDiagnostics } from './plannerDiagnostics.ts'
import './missionPlanner.css'

interface Props {
  catalogue: Record<string, SiteData>
  selected?: SiteData
  startUtc: string
  settings: MissionSettings
  onUse: (siteId: string, startUtc: string, durationDays: number) => void
}

/** "Point 75.000°S, 30.000°E" for a free surface point, else null. */
const pointName = (id: string) => { const p = parseFreePointId(id); return p ? `Point ${fmtLatLon(p.latDeg, p.lonDeg)}` : null }

export function MissionPlanner({ catalogue, selected, startUtc, settings, onUse }: Props) {
  const [mode, setMode] = useState<'hemisphere' | 'mission'>('hemisphere')
  const [metric, setMetric] = useState<SearchMetric>('minSoc')
  const [spacing, setSpacing] = useState(15)
  const [region, setRegion] = useState<SearchRegion>('polar')
  const [from, setFrom] = useState(startUtc.slice(0, 10))
  const [to, setTo] = useState('2027-11-01')
  const [maximum, setMaximum] = useState(90)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const invalidate = () => { controller.current?.abort(); setResult(null); setError('') }
  const search = async () => {
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); setResult(null); setError(''); setProgress('Loading scientific data…')
    try {
      const issues = validateSettings(settings)
      if (issues.length) throw new Error(issues.join(' '))
      const options = { signal: abort.signal, onProgress: (done: number, planned: number) => { if (!abort.signal.aborted) setProgress(`${done} calculations completed · current stage ~${planned}`) } }
      let answer: SearchResult
      if (mode === 'hemisphere') {
        answer = await runSearch({ kind: 'hemisphere', reference: catalogue.Site01, settings, startUtc, spacingDeg: spacing, sortBy: metric, region }, options)
      } else {
        if (!selected) throw new Error('Choose a location in the mission controls first.')
        let data = selected
        if (catalogue[selected.site.id] && selected.site.category !== 'custom') data = { ...selected, ephemeris: await loadYear(selected.site.id) }
        if (abort.signal.aborted) return
        answer = await runSearch({ kind: 'mission', data, settings, fromUtc: `${from}T00:00:00Z`, toUtc: `${to}T00:00:00Z`, maxDurationDays: maximum, coarseStepS: 86400, sortBy: metric }, options)
      }
      if (!abort.signal.aborted) setResult(answer)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (controller.current === abort) { setBusy(false); controller.current = null }
    }
  }
  const use = (c: SearchCandidate) => onUse(c.siteId, c.startUtc, c.durationDays ?? settings.durationDays)
  const diagnostics = result ? plannerDiagnostics(result) : null
  const blockingNote = result?.durationScreening?.earthHiddenAtEveryCoveredStart ? result.notes.find(n => n.startsWith('Earth stays hidden')) : undefined
  return <section className="card planner" aria-label="Mission recommendations">
    <h2>Find a mission that works</h2>
    <p className="muted">Keep the date and duration to find a south-polar (or southern) landing location, or keep a location to find its longest feasible mission.</p>
    <fieldset disabled={busy} className="planner__fields">
      <legend className="sr-only">Search settings</legend>
      <label>Find<select value={mode} onChange={e => { invalidate(); setMode(e.target.value as typeof mode) }}>
        <option value="hemisphere">Landing location</option><option value="mission">Landing date &amp; mission duration</option>
      </select></label>
      <label>{mode === 'mission' ? 'Tie breaker' : 'Rank feasible locations by'}<select value={metric} onChange={e => { invalidate(); setMetric(e.target.value as SearchMetric) }}>
        {Object.entries(METRICS).map(([value, m]) => <option key={value} value={value}>{m.label}</option>)}
      </select></label>
      {mode === 'hemisphere' && <label>Search area<select value={region} onChange={e => { invalidate(); setRegion(e.target.value as SearchRegion) }}>
        {(Object.keys(REGION_LABEL) as SearchRegion[]).map(r => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
      </select></label>}
      {mode === 'hemisphere' ? <label>Surface grid<select value={spacing} onChange={e => { invalidate(); setSpacing(Number(e.target.value)) }}>
        <option value={15}>15° · broad scan</option><option value={10}>10° · denser scan</option><option value={5}>5° · detailed scan, slower</option>
      </select></label> : <>
        <label>First landing date (UTC)<input type="date" required value={from} onChange={e => { invalidate(); setFrom(e.target.value) }} /></label>
        <label>Last landing date (UTC)<input type="date" required value={to} onChange={e => { invalidate(); setTo(e.target.value) }} /></label>
        <label>Maximum duration (Earth days)<input type="number" min={1} step={1} value={maximum} onChange={e => { invalidate(); setMaximum(Number(e.target.value)) }} /></label>
      </>}
    </fieldset>
    <p className="small muted">{mode === 'hemisphere' ? `Fixed: ${fmtUtc(startUtc)} · ${settings.durationDays} Earth days. Global terrain screening; local refinement around five leaders.` : `Fixed: ${selected?.site.name ?? 'choose a location above'}. Daily UTC starts, whole-day durations; longest feasible mission first.`}</p>
    <div className="planner__actions"><button type="button" className="primary" disabled={busy || (mode === 'mission' && !selected)} onClick={search}>Find best {mode === 'hemisphere' ? 'location' : 'date & duration'}</button>
      {busy && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setProgress('Search cancelled. Run again to obtain a complete recommendation.') }}>Cancel search</button>}
      <span role="status" aria-live="polite">{busy ? progress : progress.startsWith('Search cancelled') ? progress : ''}</span>
    </div>
    {error && <p role="alert" className="bad">{error} Adjust the search or retry.</p>}
    {result && <div className="planner__results" aria-live="polite">
      <h3>{result.best ? 'Recommended among tested options' : result.status === 'complete' ? 'No tested option meets every limit' : 'Search incomplete'}</h3>
      <p className="muted small">{result.tested} calculations · {result.spatialCoverage.places} {result.spatialCoverage.places === 1 ? 'location' : 'locations'} · {(result.elapsedMs / 1000).toFixed(1)} s</p>
      {result.feasible.slice(0, 5).map((c, i) => <div className="planner__option" key={`${c.siteId}:${c.startUtc}`}>
        <div><strong>{i + 1}. {catalogue[c.siteId]?.site.name ?? (pointName(c.siteId) ?? selected?.site.name ?? c.siteId)}</strong>
          <p>{fmtUtc(c.startUtc)} · {c.durationDays ?? settings.durationDays} days</p>
          <p className="small muted">Lowest battery {(c.metrics!.minSocFraction * 100).toFixed(1)}% · longest Earth outage {(c.metrics!.longestEarthOutageS / 3600).toFixed(1)} h · Sun &amp; Earth {(c.metrics!.bothVisibleFraction * 100).toFixed(1)}%</p>
          <p className="small muted">{c.precisionLabel}</p>
        </div><button type="button" disabled={result.status !== 'complete'} onClick={() => use(c)}>Use this mission</button>
      </div>)}
      {!result.feasible.length && result.status === 'complete' && diagnostics && <>
        {blockingNote && <p><strong>Earth contact blocks every tested mission.</strong> {blockingNote}</p>}
        <p>{diagnostics.explanation}</p>
        <h4>What ruled out the {result.durationScreening ? 'tested starts' : 'tested candidates'}?</h4>
        <ul>{diagnostics.failures.map(f => <li key={f.code}>{f.label}: <strong>{f.count} / {diagnostics.denominator}</strong> {result.durationScreening ? 'sampled starts' : 'tested candidates'}</li>)}</ul>
        <p className="small muted">A start may fail more than one condition. Coverage failures indicate unavailable data, not a failed physical mission.</p>
        {result.rejected.some(c => c.summary) && <details>
          <summary>See example rejected {result.durationScreening ? '1-day missions' : 'missions'}</summary>
          {result.rejected.filter(c => c.summary).slice(0, 3).map(c => <div className="planner__option" key={`${c.siteId}:${c.startUtc}`}>
            <div><strong>{fmtUtc(c.startUtc)} · {c.durationDays ?? settings.durationDays} days</strong>
              <ul>{c.failures.map(f => <li key={f.code}>{f.message}</li>)}</ul>
            </div>
            <button type="button" onClick={() => use(c)}>Simulate this failed attempt</button>
          </div>)}
        </details>}
      </>}
      {result.notes.filter(n => !n.startsWith('Screening finalists') && n !== blockingNote).map((n, i) => <p key={i} className="small muted">{n}</p>)}
    </div>}
  </section>
}
