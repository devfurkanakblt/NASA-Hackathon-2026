import type { Scenario } from '../app/scenarios.ts'
import type { SitesDoc } from '../data/contract.ts'
import { fromInputUtc, shiftUtc, toInputUtc } from '../app/format.ts'
import { MIN_DURATION_DAYS } from '../sim/evaluate.ts'
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
  onCopy?: () => void
}

/** A short editor for the same scenario state used by Results and shared links. */
export function SceneMissionControls({ sites, scenarios, chosenKey, durationDays, endUtc, onPatch, onDuration, onCoordinate }: Props) {
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
      {onCoordinate && <details><summary>Choose your own coordinates</summary>
        <p className="scene-mission__hint">Any point on the Moon. Inside the ±3 km polar maps the nearest 100–200 m grid point is used (distance reported); elsewhere your exact coordinate is computed from the global LOLA terrain as a screening estimate.</p>
        <div className="scene-mission__fields">
          <label>Latitude · degrees<input aria-label="Custom latitude" inputMode="decimal" value={latitude} onChange={e => setLatitude(e.target.value)} /></label>
          <label>Longitude · east positive<input aria-label="Custom longitude" inputMode="decimal" value={longitude} onChange={e => setLongitude(e.target.value)} /></label>
          <button type="button" onClick={() => setCoordinateMessage(onCoordinate(latitude.trim() ? Number(latitude) : NaN, longitude.trim() ? Number(longitude) : NaN))}>Use coordinates</button>
        </div>
        {coordinateMessage && <p role="status">{coordinateMessage}</p>}
      </details>}
      <div className="scene-mission__fields">
        <label><span>Location</span>
          <select aria-label="Simulation location" value={chosen.siteId} onChange={e => onPatch({ siteId: e.target.value })}>
            {!isCatalogue && <option value={chosen.siteId}>{chosen.siteId.startsWith('pt:') ? 'Your coordinate' : 'Selected regional map point'}</option>}
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
        <span className="scene-mission__hint">Duration is shared by all selected scenarios.</span>
      </div>
    </div>
  )
}
