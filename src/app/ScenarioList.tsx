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
}

/** Up to three scenarios (site + start time). The active one drives the panorama, 3D view and power chart. */
export function ScenarioList({ sites, scenarios, outcomes, colors, activeKey, onChange, onActivate }: Props) {
  const polar = sites.sites.filter((s) => s.category !== 'contrast')
  const contrast = sites.sites.filter((s) => s.category === 'contrast')
  const { startUtc: minUtc, endUtc: maxUtc } = sites.coverage
  const update = (key: string, patch: Partial<Scenario>) => onChange(scenarios.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  return (
    <div className="scenarios">
      {scenarios.map((s, i) => {
        const error = outcomes[i]?.error
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
                  max={toInputUtc(maxUtc)}
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
            {error && (
              <p className="bad small" role="alert">
                {error}
              </p>
            )}
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
      <p className="muted small">
        Data covers {minUtc.slice(0, 10)} to {maxUtc.slice(0, 10)} UTC in 10-minute steps.
      </p>
    </div>
  )
}
