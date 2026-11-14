import { useState } from 'react'
import type { SitesDoc } from '../data/contract.ts'
import { MAX_SCENARIOS } from '../sim/evaluate.ts'
import { fromInputUtc, shiftUtc, toInputUtc } from './format.ts'
import { LETTERS, newKey, siteTitle } from './scenarios.ts'
import type { Scenario, ScenarioOutcome } from './scenarios.ts'

interface Props {
  sites: SitesDoc
  scenarios: Scenario[]
  outcomes: ScenarioOutcome[]
  colors: string[]
  activeKey: string | null
  onChange: (scenarios: Scenario[]) => void
  onActivate: (key: string) => void
  /** Latest start the date picker allows for a site id (year end once its one-year file is in). */
  maxStartFor: (siteId: string) => string
  /** Nearest regional map cell to a coordinate. */
  snap: (latDeg: number, lonDeg: number) => { siteId: string; row: number; col: number; distanceM: number } | { error: string }
  cellId: (siteId: string, row: number, col: number) => string
  /** The chosen scenario is still loading its files: "Use point" waits. */
  busy?: boolean
}

/** Up to three scenarios (site + start time). The active one drives the panorama, 3D view and power chart. */
export function ScenarioList({ sites, scenarios, outcomes, colors, activeKey, onChange, onActivate, maxStartFor, snap, cellId, busy }: Props) {
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [snapMsg, setSnapMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const siteIds = new Set(sites.sites.map((s) => s.id))
  const polar = sites.sites.filter((s) => s.category !== 'contrast')
  const contrast = sites.sites.filter((s) => s.category === 'contrast')
  const { startUtc: minUtc, endUtc: maxUtc } = sites.coverage
  const usePoint = () => {
    const target = scenarios.find((s) => s.key === activeKey) ?? scenarios[0]
    const r = snap(Number(lat.trim() === '' ? NaN : lat), Number(lon.trim() === '' ? NaN : lon))
    if ('error' in r) return setSnapMsg({ ok: false, text: r.error })
    const id = cellId(r.siteId, r.row, r.col)
    if (target) update(target.key, { siteId: id })
    setSnapMsg({ ok: true, text: `Snapped to ${id} (${Math.round(r.distanceM)} m away).` })
  }
  const update = (key: string, patch: Partial<Scenario>) => onChange(scenarios.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  return (
    <div className="scenarios">
      {scenarios.map((s, i) => {
        const error = outcomes[i]?.error
        const loading = outcomes[i]?.loading
        return (
          <div key={s.key} className={`scenario${s.key === activeKey ? ' is-active' : ''}`} style={{ borderColor: s.key === activeKey ? colors[i] : undefined }}>
            <div className="scenario__head">
              <button type="button" className="scenario__letter" style={{ background: colors[i] }} onClick={() => onActivate(s.key)} title="Show this scenario in the panorama, 3D view and power chart">
                {LETTERS[i]}
              </button>
              <select aria-label={`Scenario ${LETTERS[i]} site`} value={s.siteId} onChange={(e) => update(s.key, { siteId: e.target.value })}>
                <optgroup label="South polar sites">
                  {polar.map((site) => (
                    <option key={site.id} value={site.id}>
                      {siteTitle(site)}
                    </option>
                  ))}
                </optgroup>
                {!siteIds.has(s.siteId) && (
                  <optgroup label="Regional map point">
                    <option value={s.siteId}>{s.siteId} — map point (1° horizon)</option>
                  </optgroup>
                )}
                {contrast.length > 0 && (
                  <optgroup label="Contrast points (educational comparison)">
                    {contrast.map((site) => (
                      <option key={site.id} value={site.id}>
                        {siteTitle(site)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {scenarios.length > 1 && (
                <button type="button" className="icon" aria-label={`Remove scenario ${LETTERS[i]}`} onClick={() => onChange(scenarios.filter((x) => x.key !== s.key))}>
                  ×
                </button>
              )}
            </div>
            <div className="scenario__time">
              <label>
                <span>Start (UTC)</span>
                <input
                  type="datetime-local"
                  step={600}
                  value={toInputUtc(s.startUtc)}
                  min={toInputUtc(minUtc)}
                  max={toInputUtc(maxStartFor(s.siteId))}
                  onChange={(e) => {
                    const iso = fromInputUtc(e.target.value)
                    if (iso) update(s.key, { startUtc: iso })
                  }}
                />
              </label>
              <span className="scenario__shift">
                <button type="button" onClick={() => update(s.key, { startUtc: shiftUtc(s.startUtc, -24) })}>
                  −24 h
                </button>
                <button type="button" onClick={() => update(s.key, { startUtc: shiftUtc(s.startUtc, 24) })}>
                  +24 h
                </button>
                <button type="button" onClick={() => update(s.key, { startUtc: shiftUtc(s.startUtc, 72) })}>
                  +72 h
                </button>
              </span>
            </div>
            {error &&
              (loading ? (
                <p className="muted small" role="status">
                  {error}
                </p>
              ) : (
                <p className="bad small" role="alert">
                  {error}
                </p>
              ))}
          </div>
        )
      })}
      {scenarios.length < MAX_SCENARIOS && (
        <button
          type="button"
          className="scenario__add"
          onClick={() => {
            const base = scenarios.find((s) => s.key === activeKey) ?? scenarios[scenarios.length - 1]
            const copy = base ? { ...base, key: newKey() } : { key: newKey(), siteId: sites.sites[0].id, startUtc: sites.coverage.startUtc }
            onChange([...scenarios, copy])
            onActivate(copy.key)
          }}
        >
          + Copy scenario to compare (max {MAX_SCENARIOS})
        </button>
      )}
      <div className="scenario__point">
        <span className="small">Lat / Lon (±3 km of a site)</span>
        <div className="scenario__point-row">
          <input aria-label="Latitude in degrees" inputMode="decimal" placeholder="lat −89.46" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input aria-label="Longitude in degrees (east positive)" inputMode="decimal" placeholder="lon −137.49" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button type="button" onClick={usePoint} disabled={busy} title="Move the active scenario to the nearest regional map cell">
            Use point
          </button>
        </div>
        {snapMsg && (
          <p className={`small ${snapMsg.ok ? 'muted' : 'bad'}`} role="status">
            {snapMsg.text}
          </p>
        )}
      </div>
      <p className="muted small">
        Start dates from {minUtc.slice(0, 10)} to 2027-11-01 UTC in 10-minute steps. Dates after {maxUtc.slice(0, 10)} and map points load a one-year file for that site first.
      </p>
    </div>
  )
}
