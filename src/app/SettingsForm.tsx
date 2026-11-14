import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, MAX_DURATION_DAYS, MIN_DURATION_DAYS } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'

interface Props {
  settings: MissionSettings
  issues: string[]
  onChange: (patch: Partial<MissionSettings>) => void
  onReset: () => void
}

/**
 * Number field that keeps what the user typed (so an empty or half-typed value does not jump),
 * and reports the value in engine units through `toEngine`.
 */
function NumberField(props: { label: string; unit: string; value: number; min?: number; max?: number; step?: number; scale?: number; onValue: (v: number) => void }) {
  const { label, unit, value, min, max, step = 1, scale = 1, onValue } = props
  const shown = Math.round((value / scale) * 1e6) / 1e6
  const [text, setText] = useState(String(shown))
  useEffect(() => {
    if (Number(text) !== shown || text.trim() === '') setText(Number.isFinite(shown) ? String(shown) : text)
    // Only resync when the value changes from outside (reset, rounding).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field__input">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            setText(e.target.value)
            const v = e.target.value.trim() === '' ? NaN : Number(e.target.value)
            onValue(v * scale)
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}

/** Mission and hardware assumptions shared by every scenario (plan defaults, labelled as examples). */
export function SettingsForm({ settings: s, issues, onChange, onReset }: Props) {
  return (
    <div className="settings">
      <fieldset>
        <legend>Mission goals</legend>
        <NumberField label="Duration" unit="days" value={s.durationDays} min={MIN_DURATION_DAYS} max={MAX_DURATION_DAYS} onValue={(v) => onChange({ durationDays: v })} />
        <NumberField label="Longest time without Earth allowed" unit="h" value={s.maxEarthOutageH} min={0} step={1} onValue={(v) => onChange({ maxEarthOutageH: v })} />
      </fieldset>
      <fieldset>
        <legend>Solar panel</legend>
        <label className="field">
          <span>Pointing</span>
          <select value={s.panelMode} onChange={(e) => onChange({ panelMode: e.target.value as MissionSettings['panelMode'] })}>
            <option value="tracking">Ideal Sun tracking</option>
            <option value="fixed">Fixed direction</option>
          </select>
        </label>
        {s.panelMode === 'fixed' && (
          <>
            <NumberField label="Facing azimuth" unit="°" value={s.fixedNormalAzDeg} min={0} max={359} step={5} onValue={(v) => onChange({ fixedNormalAzDeg: v })} />
            <NumberField label="Facing elevation" unit="°" value={s.fixedNormalElDeg} min={-90} max={90} step={1} onValue={(v) => onChange({ fixedNormalElDeg: v })} />
          </>
        )}
        <NumberField label="Area" unit="m²" value={s.panelAreaM2} min={0} step={0.5} onValue={(v) => onChange({ panelAreaM2: v })} />
        <NumberField label="Cell efficiency" unit="%" value={s.panelEfficiency} scale={0.01} min={0} max={100} onValue={(v) => onChange({ panelEfficiency: v })} />
        <NumberField label="System factor" unit="%" value={s.systemFactor} scale={0.01} min={0} max={100} onValue={(v) => onChange({ systemFactor: v })} />
        <label className="field field--check">
          <input type="checkbox" checked={s.sunDiskModel === 'partial'} onChange={(e) => onChange({ sunDiskModel: e.target.checked ? 'partial' : 'centre' })} />
          <span>Partial Sun disk (scale output by the visible share of the disk)</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Battery</legend>
        <NumberField label="Capacity" unit="kWh" value={s.batteryCapacityWh} scale={1000} min={0} step={0.5} onValue={(v) => onChange({ batteryCapacityWh: v })} />
        <NumberField label="Charge at start" unit="%" value={s.initialSocFraction} scale={0.01} min={0} max={100} onValue={(v) => onChange({ initialSocFraction: v })} />
        <NumberField label="Safety reserve" unit="%" value={s.reserveFraction} scale={0.01} min={0} max={100} onValue={(v) => onChange({ reserveFraction: v })} />
        <NumberField label="Charge efficiency" unit="%" value={s.chargeEfficiency} scale={0.01} min={1} max={100} onValue={(v) => onChange({ chargeEfficiency: v })} />
        <NumberField label="Discharge efficiency" unit="%" value={s.dischargeEfficiency} scale={0.01} min={1} max={100} onValue={(v) => onChange({ dischargeEfficiency: v })} />
      </fieldset>
      <fieldset>
        <legend>Power demand</legend>
        <NumberField label="Power used at all times" unit="W" value={s.baseLoadW} min={0} step={10} onValue={(v) => onChange({ baseLoadW: v })} />
        <NumberField label="Extra power for the radio" unit="W" value={s.commLoadW} min={0} step={10} onValue={(v) => onChange({ commLoadW: v })} />
      </fieldset>
      {issues.length > 0 && (
        <ul className="issues" role="alert">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <button type="button" className="link" onClick={onReset} disabled={JSON.stringify(s) === JSON.stringify(DEFAULT_SETTINGS)}>
        Reset to example defaults
      </button>
    </div>
  )
}
