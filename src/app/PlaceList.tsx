import type { CSSProperties } from 'react'
import type { SiteEntry } from '../data/contract.ts'
import { isOnGlobe, placeGroups } from './globeView.ts'

/**
 * Every catalogue place as a toggle, grouped like the research alternatives. The globe cannot
 * show places in the northern hemisphere, and the pole is too crowded to read every name there.
 */
export function PlaceList({ sites, chosen, colors, onToggle }: {
  sites: SiteEntry[]
  /** Chosen site ids, in comparison order (letter A, B, C). */
  chosen: string[]
  colors: readonly string[]
  onToggle: (site: SiteEntry) => void
}) {
  const full = chosen.length >= 3
  return (
    <div className="place-list">
      {placeGroups(sites).map((group) => (
        <fieldset key={group.id}>
          <legend>{group.title} ({group.sites.length})</legend>
          <div className="place-list__items">
            {group.sites.map((site) => {
              const index = chosen.indexOf(site.id)
              const on = index >= 0
              return (
                <button key={site.id} type="button" aria-pressed={on} disabled={!on && full}
                  style={on ? ({ '--place-color': colors[index] } as CSSProperties) : undefined}
                  title={on ? 'Remove this place from the comparison' : full ? 'Three places are chosen; remove one first' : 'Add this place to the comparison'}
                  onClick={() => onToggle(site)}>
                  {on && `${String.fromCharCode(65 + index)} · `}{site.name}
                  {!isOnGlobe(site) && <span className="place-list__note"> · north, not on the globe</span>}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
