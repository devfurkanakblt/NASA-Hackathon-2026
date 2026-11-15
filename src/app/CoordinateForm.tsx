import { useState } from 'react'
import { REFERENCE_LANDINGS } from './referenceLandings.ts'

interface Props {
  /** Button text, e.g. "Add point". */
  action: string
  disabled?: boolean
  /** Returns the message to show (what was used, or why not). */
  onUse: (latDeg: number, lonDeg: number) => { ok: boolean; text: string }
}

/** Latitude / longitude entry for any point on the Moon. */
export function CoordinateForm({ action, disabled, onUse }: Props) {
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v.trim().replace(',', '.')))
  return (
    <form
      className="coordinate-form"
      onSubmit={(e) => {
        e.preventDefault()
        setMsg(onUse(num(lat), num(lon)))
      }}
    >
      <div className="coordinate-form__row">
        <label>
          <span>Latitude °</span>
          <input aria-label="Latitude in degrees" inputMode="decimal" placeholder="−9.0" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          <span>Longitude °</span>
          <input aria-label="Longitude in degrees, east positive" inputMode="decimal" placeholder="15.5" value={lon} onChange={(e) => setLon(e.target.value)} />
        </label>
        <button type="submit" disabled={disabled}>
          {action}
        </button>
      </div>
      <div className="coordinate-form__presets" role="group" aria-label="Past landings outside the south-polar catalogue">
        <span className="small muted">Past landings (northern &amp; equatorial, global-terrain estimate):</span>
        {REFERENCE_LANDINGS.map((p) => (
          <button key={p.name} type="button" disabled={disabled} onClick={() => { setLat(String(p.latDeg)); setLon(String(p.lonDeg)); setMsg(onUse(p.latDeg, p.lonDeg)) }}>
            {p.name}
          </button>
        ))}
      </div>
      {msg && (
        <p className={`small ${msg.ok ? 'muted' : 'bad'}`} role="status">
          {msg.text}
        </p>
      )}
    </form>
  )
}
