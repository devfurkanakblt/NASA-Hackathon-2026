import type { CSSProperties } from 'react'
import type { SiteEntry } from '../data/contract.ts'
import { placeGroups } from './globeView.ts'
import { scenarioLabel } from './scenarios.ts'

/**
 * Every catalogue place as a toggle, grouped like the research alternatives: the pole is too
 * crowded on the globe to read every name there.
 */
export function PlaceList({ sites, chosen, colors, onToggle }: {
  sites: SiteEntry[]
  /** Chosen site ids, in comparison order (letter A, B, C). */
  chosen: string[]
  colors: readonly string[]
  onToggle: (site: SiteEntry) => void
}) {
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
                <button key={site.id} type="button" aria-pressed={on}
                  style={on ? ({ '--place-color': colors[index] } as CSSProperties) : undefined}
                  title={on ? 'Remove this place from the comparison' : 'Add this place to the comparison'}
                  onClick={() => onToggle(site)}>
                  {on && `${scenarioLabel(index)} · `}{site.name}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
