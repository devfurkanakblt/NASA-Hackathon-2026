import type { SiteData } from '../data/contract.ts'
import type { ScenarioResult } from '../sim/evaluate.ts'

/** Where every number comes from, and what the model does not cover. */
export function Sources({ data, result }: { data: SiteData; result: ScenarioResult | null }) {
  const { site, horizon, ephemeris } = data
  const warnings = [...new Set([...site.warnings, ...(horizon.warnings ?? []), ...(data.visualWarnings ?? [])])]
  return (
    <div className="sources">
      <div className="sources__site">
        <h3>
          {site.id} — {site.name}
        </h3>
        <p className="tag-line">{site.label}</p>
        <dl>
          <dt>Coordinates</dt>
          <dd>
            {site.latDeg.toFixed(4)}°, {site.lonDeg.toFixed(4)}° (east positive) · {site.coordSource}
          </dd>
          {site.derivation && (
            <>
              <dt>Derived point</dt>
              <dd>
                From {site.derivedFrom}: {site.derivation}
              </dd>
            </>
          )}
          <dt>Terrain horizon</dt>
          <dd>
            {horizon.count} azimuths ({horizon.azStepDeg}° steps) · near: {site.demNear} · far: {site.demFar}
            {!horizon.distanceM && ' · 1° horizon, no distance data; summary maps use 0.5°'}
          </dd>
          <dt>Sun &amp; Earth positions</dt>
          <dd>
            {ephemeris.source === 'jpl-horizons' ? 'JPL Horizons' : ephemeris.source}, observer {site.observerHeightM} m above the surface, {ephemeris.stepS / 60}-minute steps, UTC, no refraction
          </dd>
        </dl>
        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3>Model limits</h3>
        <ul>
          {(result?.model.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Hardware values are example assumptions. Sites are research region centres, not certified landing sites.</li>
          <li>Near the pole the Sun and Earth cross the horizon slowly: a 0.05° horizon error can shift rise/set estimates by roughly 30 min to 4 h, depending on the crossing.</li>
          <li>The 3D terrain is for orientation only; visibility always comes from the horizon profile.</li>
        </ul>
        <h3>NASA data</h3>
        <ul>
          <li>JPL Horizons System — Sun and Earth positions seen from the lunar surface</li>
          <li>LOLA 5 m/px south-pole landing-site DEMs (Barker et al. 2021) and LOLA 80 m/px south-pole DEM (Barker et al. 2023), NASA GSFC PGDA</li>
          <li>NASA Lunar Surface Data Book (M2M-30044, Mar 2025), Table A2.1-1 — site coordinates</li>
          <li>LOLA global DEM LDEM_64 (PDS) — terrain of the two comparison points away from the pole</li>
          <li>LROC (ASU/NASA) and NASA NSSDC — coordinates of the Chang'e-6 and Apollo comparison points</li>
          <li>NASA Moon Trek, LOLA 30 m/px south-pole DEM — regional terrain in the 3D view (display only)</li>
          <li>NASA Earth Observatory, Blue Marble: Next Generation (Nov 2004) — archive composite for the Earth in the 3D view (display only; not live imagery or weather)</li>
          <li>Solar constant {result?.model.solarConstantWm2 ?? 1361} W/m² (NASA GSFC)</li>
        </ul>
        <p className="muted small">
          All values are pre-computed offline. The site files load once at start; the one-year series and map-point horizons of a site are fetched from the same place when a scenario needs
          them. No outside server is contacted.
        </p>
      </div>
    </div>
  )
}
