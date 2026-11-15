import { fmtLatLon } from './format.ts'

/**
 * A listed location's name and coordinates as one button: it opens the place on the
 * Simulation page's Moon (behind the screen blackout), chosen as if picked on the globe.
 */
export function PlaceLink({ rank, name, at, onShow }: {
  rank?: number
  name: string
  at: { latDeg: number; lonDeg: number } | null
  onShow: () => void
}) {
  return <button type="button" className="place-link" onClick={onShow} title="Show this location on the Moon in the simulation">
    <strong>{rank !== undefined && `${rank}. `}{name}</strong>
    {at && <span className="place-link__coords">{fmtLatLon(at.latDeg, at.lonDeg)}</span>}
    <span className="place-link__go" aria-hidden="true">Show on the Moon ↗</span>
  </button>
}
