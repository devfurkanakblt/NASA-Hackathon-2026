import type { MissionSettings, ScenarioResult } from '../sim/evaluate.ts'
import { fmtDuration, fmtHours, fmtPct } from '../app/format.ts'

/** Public-facing explanation of the existing engine's two conditions; no invented score. */
export function SceneMissionSummary({ result, settings }: { result: ScenarioResult; settings: MissionSettings }) {
  const s = result.summary
  return <section className="scene-summary" aria-label="Mission at a glance">
    <h3>Can this mission work here?</h3>
    <p className="scene-mission__hint">Power and direct Earth visibility for your selected place and date. Research types and better places for each are on the Results page (Research tab).</p>
    <div className="scene-mission__facts">
      <div><strong className={s.keepsBatteryReserve ? 'ok' : 'bad'}>{s.keepsBatteryReserve ? 'Battery reserve protected' : 'Battery reserve runs low'}</strong>
        <p>{s.keepsBatteryReserve ? `Lowest charge: ${fmtPct(s.minSocFraction)}.` : `Reserve first crossed after ${fmtDuration(s.firstReserveViolationS ?? 0)}.`}</p></div>
      <div><strong className={s.earthOutageWithinLimit ? 'ok' : 'bad'}>{s.earthVisibleFraction === 0 ? 'Earth is out of view' : s.earthOutageWithinLimit ? 'Earth-view gaps within your limit' : 'Earth-view gaps are too long'}</strong>
        <p>Longest gap: {fmtDuration(s.longestEarthOutageS)}. Your limit: {fmtDuration(settings.maxEarthOutageH * 3600)}.</p></div>
      <div><strong>Sunlight for {fmtHours(s.sunVisibleFraction * result.durationS)}</strong>
        <p>Out of a {fmtDuration(result.durationS)} mission. Terrain can block the low Sun.</p></div>
    </div>
    <details><summary>Why these results? · model details</summary>
      <p>Changing the date moves the Sun and Earth relative to the local terrain skyline. Changing location changes that skyline. The same solar panel, battery and power demand are used for all comparison options.</p>
      <p>Sunlight alone does not guarantee enough power. Earth visibility is a line of sight, not a guaranteed radio connection. This is not a certified landing assessment or a best-place/date search.</p>
      <p>Minimum charge {fmtPct(s.minSocFraction)}; battery reserve {fmtPct(settings.reserveFraction)}; unmet demand {(s.unmetEnergyJ / 3600000).toFixed(2)} kWh.</p>
    </details>
  </section>
}
