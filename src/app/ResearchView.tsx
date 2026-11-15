import { useMemo } from 'react'
import type { Psr, SiteData } from '../data/contract.ts'
import { evaluateScenario } from '../sim/evaluate.ts'
import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { MAX_ALTERNATIVE_SLOPE_DEG, RESEARCH_TYPES, alternativesFor, researchMetrics } from '../sim/research.ts'
import type { Fit, ResearchMetrics } from '../sim/research.ts'
import { placeTitle } from './placeName.ts'

const FIT_LABEL: Record<Fit, string> = { strong: 'Good fit', possible: 'Possible', no: 'Not suited' }
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`)

/**
 * Research the chosen place suits, measured for this mission, and the best other catalogue
 * places for the same research with the same dates and hardware.
 */
export function ResearchView({ data, result, startUtc, settings, catalogue, psrs, inScenarios, canAdd, onCompare }: {
  data: SiteData
  result: ScenarioResult
  startUtc: string
  settings: MissionSettings
  /** Catalogue sites (not map points) the alternatives are chosen from. */
  catalogue: Record<string, SiteData>
  psrs: Psr[]
  /** Site ids already in the comparison. */
  inScenarios: string[]
  canAdd: boolean
  onCompare: (siteId: string) => void
}) {
  const selected = useMemo(() => researchMetrics(data, result, psrs), [data, result, psrs])
  // Every catalogue place for the same mission dates and hardware; missions outside the
  // pre-computed main period cannot be compared like for like and are skipped.
  const { candidates, skipped } = useMemo(() => {
    const out: ResearchMetrics[] = []
    let missing = 0
    for (const site of Object.values(catalogue)) {
      try {
        out.push(researchMetrics(site, evaluateScenario(site, startUtc, settings), psrs))
      } catch {
        missing++
      }
    }
    return { candidates: out, skipped: missing }
  }, [catalogue, startUtc, settings, psrs])

  const assessed = RESEARCH_TYPES.map((type) => ({ type, ...type.assess(selected) }))
  const suited = assessed.filter((a) => a.fit !== 'no')

  return (
    <div className="research">
      <p className="explain">
        What can be done at <strong>{placeTitle(data.site.id, catalogue)}</strong> during this mission, measured from NASA data.
        Each research type is a criterion NASA itself uses; the alternatives use the same dates and lander.
      </p>
      {selected.slopeDeg !== null && selected.slopeDeg > MAX_ALTERNATIVE_SLOPE_DEG && (
        <p className="research__warning">Slope here is {selected.slopeDeg.toFixed(0)}°: too steep for a safe landing, whatever the research.</p>
      )}
      <p className="research__summary">
        {suited.length ? <>Suited for: {suited.map((a) => a.type.title).join(' · ')}.</> : 'No research type below is suited here for this mission.'}
      </p>

      {assessed.map(({ type, fit, value }) => {
        const alternatives = alternativesFor(type, selected, candidates)
        return (
          <section key={type.id} className={`research__type research__type--${fit}`} aria-label={type.title}>
            <header>
              <h3>{type.title}</h3>
              <span className={`research__fit research__fit--${fit}`}>{FIT_LABEL[fit]}</span>
            </header>
            <p className="research__value">{value}</p>
            <p className="small muted">
              {type.basis} <a href={type.source.url} target="_blank" rel="noreferrer">{type.source.label}</a>. {type.rule}
            </p>
            {alternatives.length > 0 ? (
              <div className="research__alts">
                <span className="small">{fit === 'strong' ? 'Also good for this:' : 'Better places for this:'}</span>
                <ul>
                  {alternatives.map((a) => {
                    const added = inScenarios.includes(a.metrics.siteId)
                    return (
                      <li key={a.metrics.siteId}>
                        <span>
                          <strong>{placeTitle(a.metrics.siteId, catalogue)}</strong> · {FIT_LABEL[a.fit].toLowerCase()} · {a.value} · {fmtKm(a.distanceKm)} away
                        </span>
                        <button type="button" disabled={added} onClick={() => onCompare(a.metrics.siteId)}
                          title={added ? 'Already in the comparison' : canAdd ? 'Add to the comparison' : 'Replace the chosen place with this one'}>
                          {added ? 'In comparison' : canAdd ? 'Add to compare' : 'Use instead'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p className="small muted">No other catalogue place fits this research better for these dates.</p>
            )}
          </section>
        )
      })}

      <p className="small muted">
        Alternatives: catalogue places with a known slope of at most {MAX_ALTERNATIVE_SLOPE_DEG}° (app assumption), evaluated for the same
        start date, duration and lander. PSRs: NASA Moon Trek layer PSR_SP (PSRs of 10 km² or more; smaller PSRs can be closer).
        {skipped > 0 && ` ${skipped} place(s) skipped: this start date is outside their pre-computed period (1 Nov 2026 – 1 Jan 2027).`}
      </p>
    </div>
  )
}
