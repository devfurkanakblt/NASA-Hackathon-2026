import type { Scenario } from '../app/scenarios.ts'
import type { SitesDoc } from '../data/contract.ts'
import { fromInputUtc, shiftUtc, toInputUtc } from '../app/format.ts'
import { MIN_DURATION_DAYS } from '../sim/evaluate.ts'
import { scenarioLabel } from '../app/scenarios.ts'
import { REFERENCE_LANDINGS } from '../app/referenceLandings.ts'
import { latestMissionStartUtc } from './missionDates.ts'
import './sceneMissionControls.css'
import { useState } from 'react'

/** Duration used when the days field is left empty. */
const DEFAULT_MISSION_DAYS = 7

interface Props {
  sites: SitesDoc
  scenarios: Scenario[]
  chosenKey: string | null
  durationDays: number
  endUtc: string
  onChoose: (key: string) => void
  onPatch: (patch: Partial<Pick<Scenario, 'siteId' | 'startUtc'>>) => void
  onDuration: (days: number) => void
  onCoordinate?: (latitude: number, longitude: number) => string
  /** Adds a scenario at the chosen place with this start (another date for the same site). */
  onCopy?: (startUtc: string) => void
  onRemove?: (key: string) => void
  /** Name shown for a scenario in the switcher (place, plus date when the place repeats). */
  titleOf?: (scenario: Scenario) => string
  /** Adds a copy of the chosen scenario at this start; the chosen one is kept as it is. */
  onCompareAt?: (startUtc: string) => void
}

/** Days a copied scenario is moved forward, so the new date differs from the original. */
const COPY_SHIFT_DAYS = 7

/** A short editor for the same scenario state used by Results and shared links. */
export function SceneMissionControls({ sites, scenarios, chosenKey, durationDays, endUtc, onChoose, onPatch, onDuration, onCoordinate, onCopy, onRemove, titleOf, onCompareAt }: Props) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [coordinateMessage, setCoordinateMessage] = useState('')
  // Raw text while editing, so the field can be cleared; null shows the committed duration.
  const [daysDraft, setDaysDraft] = useState<string | null>(null)
  const chosen = scenarios.find(s => s.key === chosenKey)
  if (!chosen) return null
  const latest = latestMissionStartUtc(endUtc, durationDays)
  const isCatalogue = sites.sites.some(s => s.id === chosen.siteId)
  const dateChanged = (value: string) => {
    const utc = fromInputUtc(value)
    if (utc && utc !== chosen.startUtc) onPatch({ startUtc: utc })
  }
  const canShift = (days: number) => {
    if (!latest) return false
    const ms = Date.parse(shiftUtc(chosen.startUtc, days * 24))
    return ms >= Date.parse(sites.coverage.startUtc) && ms <= Date.parse(latest)
  }
  return (
    <div className="scene-mission" data-tour="places">
      <div className="scene-mission__scenarios" role="group" aria-label="Scenarios">
        <span>Scenario</span>
        {scenarios.map((s, i) => <button key={s.key} type="button" aria-pressed={s.key === chosen.key} onClick={() => onChoose(s.key)}>
          {scenarioLabel(i)} · {titleOf ? titleOf(s) : s.siteId}
        </button>)}
        {onCopy && <button type="button" onClick={() => onCopy(canShift(COPY_SHIFT_DAYS) ? shiftUtc(chosen.startUtc, COPY_SHIFT_DAYS * 24) : chosen.startUtc)}
          title="Adds a new scenario at this place, one week later; then change its date below.">+ Another date here</button>}
        {onRemove && scenarios.length > 1 && <button type="button" onClick={() => onRemove(chosen.key)}>Remove {scenarioLabel(scenarios.indexOf(chosen))}</button>}
      </div>
      {onCoordinate && <details><summary>Choose your own coordinates</summary>
        <p className="scene-mission__hint">Any point on the Moon. Inside the ±3 km polar maps the nearest 100–200 m grid point is used (distance reported); elsewhere your exact coordinate is computed from the global LOLA terrain as a screening estimate.</p>
        <div className="scene-mission__fields">
          <label>Latitude · degrees<input aria-label="Custom latitude" inputMode="decimal" value={latitude} onChange={e => setLatitude(e.target.value)} /></label>
          <label>Longitude · east positive<input aria-label="Custom longitude" inputMode="decimal" value={longitude} onChange={e => setLongitude(e.target.value)} /></label>
          <button type="button" onClick={() => setCoordinateMessage(onCoordinate(latitude.trim() ? Number(latitude) : NaN, longitude.trim() ? Number(longitude) : NaN))}>Use coordinates</button>
        </div>
        <div className="scene-mission__shifts" role="group" aria-label="Past landings outside the south-polar catalogue">
          <span>Past landings</span>
          {REFERENCE_LANDINGS.map(p => <button key={p.name} type="button" onClick={() => { setLatitude(String(p.latDeg)); setLongitude(String(p.lonDeg)); setCoordinateMessage(onCoordinate(p.latDeg, p.lonDeg)) }}>{p.name}</button>)}
        </div>
        {coordinateMessage && <p role="status">{coordinateMessage}</p>}
      </details>}
      <div className="scene-mission__fields">
        <label><span>Location</span>
          <select aria-label="Simulation location" value={chosen.siteId} onChange={e => onPatch({ siteId: e.target.value })}>
            {!isCatalogue && <option value={chosen.siteId}>{chosen.siteId.startsWith('pt:') ? 'Your coordinate' : /:r\d+c\d+$/.test(chosen.siteId) ? 'Selected regional map point' : 'Imported data package'}</option>}
            <optgroup label="South-pole research points">
              {sites.sites.filter(s => s.category !== 'contrast').map(s => <option key={s.id} value={s.id}>{s.name}{s.derivedFrom ? ' · derived point' : ''} ({s.id})</option>)}
            </optgroup>
            <optgroup label="Educational comparison points">
              {sites.sites.filter(s => s.category === 'contrast').map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
            </optgroup>
          </select>
        </label>
        <label><span>Landing date & time · UTC</span>
          <input aria-label="Simulation landing date and time UTC" type="datetime-local" step={600} value={toInputUtc(chosen.startUtc)} min={toInputUtc(sites.coverage.startUtc)} max={latest ? toInputUtc(latest) : undefined} onInput={e => dateChanged(e.currentTarget.value)} onChange={e => dateChanged(e.currentTarget.value)} />
        </label>
        <label className="scene-mission__duration"><span>Mission · days</span>
          <input aria-label="Simulation mission duration in days" type="number" min={MIN_DURATION_DAYS} step={1} value={daysDraft ?? String(durationDays)}
            onChange={e => { setDaysDraft(e.currentTarget.value); const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) onDuration(value) }}
            onBlur={e => { if (!Number.isFinite(e.currentTarget.valueAsNumber)) onDuration(DEFAULT_MISSION_DAYS); setDaysDraft(null) }} />
        </label>
      </div>
      <div className="scene-mission__shifts" role="group" aria-label="Shift selected landing date">
        <span>Move this start</span>
        {[-1, 1, 5].map(days => <button key={days} type="button" disabled={!canShift(days)} onClick={() => onPatch({ startUtc: shiftUtc(chosen.startUtc, days * 24) })}>{days > 0 ? '+' : '−'}{Math.abs(days)} {Math.abs(days) === 1 ? 'day' : 'days'}</button>)}
        <span className="scene-mission__hint">Changes apply to the selected scenario only. Duration is shared by all scenarios.</span>
      </div>
      {onCompareAt && <div className="scene-mission__shifts" role="group" aria-label="Compare the same place at another date">
        <span>Keep this start and compare</span>
        <button type="button" disabled={!canShift(5)} title={canShift(5) ? 'Adds a copy of this scenario 120 hours later; this one stays as it is.' : 'Five days later the mission would end after the available data.'}
          onClick={() => onCompareAt(shiftUtc(chosen.startUtc, 120))}>Compare +5 days</button>
        {!canShift(5) && <span className="scene-mission__hint">Not available: five days later the mission would end after the data ({latest ? toInputUtc(latest).replace('T', ' ') : 'no valid start'} UTC is the last start).</span>}
      </div>}
    </div>
  )
}
