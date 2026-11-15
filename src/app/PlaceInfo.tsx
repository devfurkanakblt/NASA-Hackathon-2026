import { useEffect, useId, useRef, useState } from 'react'
import type { SiteEntry } from '../data/contract.ts'

const STATUS: Record<string, string> = {
  landed: 'Historical landing site',
  'region-representative': 'Representative point of a region',
  'research-candidate': 'Published research candidate (not an approved landing site)',
  'planned-target': 'Planned target of a future mission (not a landing yet)',
}

export interface PlaceInfoText {
  title: string
  coordinate: string
  kind: string
  research: string
  details: string[]
}

const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`

/**
 * What the small window on the globe says about a place. Only what the catalogue states: no
 * research types are invented. There is no verified research profile for any place yet, so the
 * research line says so.
 */
export function placeInfo(site: SiteEntry): PlaceInfoText {
  const kind =
    (site.coordinateStatus && STATUS[site.coordinateStatus]) ??
    (site.category === 'contrast' ? 'Comparison point away from the pole' : site.derivedFrom ? `Point derived from ${site.derivedFrom}` : 'South-pole research point')
  const details = [
    site.label,
    ...(site.mission && site.mission !== site.name ? [`Mission: ${site.mission}`] : []),
    ...(site.program ? [`Program: ${site.program}`] : []),
    ...site.warnings,
    `Coordinate source: ${site.coordSource}`,
    `Terrain: ${site.demNear}${site.demFar && site.demFar !== site.demNear ? `; far: ${site.demFar}` : ''}`,
  ]
  return {
    title: site.name,
    coordinate: `${deg(site.latDeg, 'N', 'S')}, ${deg(site.lonDeg, 'E', 'W')}`,
    kind,
    research: 'Research information for this point has not been verified yet. Add it to see its light, Earth view and the Research tab.',
    details,
  }
}

/**
 * An info button beside a globe label. Hover or keyboard focus shows the window; a click or tap
 * keeps it open; Escape or a second tap closes it. It never adds or removes the place: only the
 * label itself does that.
 */
export function PlaceInfo({ site }: { site: SiteEntry }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const info = placeInfo(site)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [open])
  return (
    <span ref={ref} className={`place-info${open ? ' is-open' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
      <button type="button" className="place-info__button" aria-expanded={open} aria-controls={id} aria-label={`About ${site.name}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>i</button>
      <span id={id} role="dialog" aria-label={`About ${site.name}`} className="place-info__window">
        <b>{info.title}</b>
        <span className="place-info__coord">{info.coordinate}</span>
        <span>{info.kind}</span>
        <span className="place-info__research">{info.research}</span>
        <details>
          <summary>Details</summary>
          <ul>{info.details.map((d) => <li key={d}>{d}</li>)}</ul>
        </details>
      </span>
    </span>
  )
}
