import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../data/contract.ts'
import { loadAllData } from '../data/load.ts'
import { MissionScene3D } from '../scene3d/index.ts'
import type { BodyState, PanelState } from '../scene3d/index.ts'
import { J_PER_WH } from '../sim/energy.ts'
import { DEFAULT_SETTINGS, validateSettings } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { nextTransition } from '../sim/visibility.ts'
import type { VisibilityWindow } from '../sim/visibility.ts'
import { LineChart } from './charts/LineChart.tsx'
import { Panorama } from './charts/Panorama.tsx'
import { SeasonChart } from './charts/SeasonChart.tsx'
import { SiteMap } from './charts/SiteMap.tsx'
import { Comparison } from './Comparison.tsx'
import { errorMessage, fmtDuration, fmtUtc } from './format.ts'
import { ScenarioList } from './ScenarioList.tsx'
import { defaultScenarios, evaluateAll, isEvaluated } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import { SettingsForm } from './SettingsForm.tsx'
import { isKnownSiteId } from './extendedSites.ts'
import { decodeShare, encodeShare } from './share.ts'
import { Sources } from './Sources.tsx'
import { Timelines } from './Timelines.tsx'
import './app.css'

/** Scenario colours A, B, C (distinct on the dark background and for common colour blindness). */
const COLORS = ['#f2a541', '#4cc9f0', '#c77dff']
const STEPS_PER_FRAME = 2

function countdown(name: string, windows: VisibilityWindow[], visibleNow: boolean, tS: number): string {
  const next = nextTransition(windows, tS)
  if (!next) return `${name} ${visibleNow ? 'stays in view' : 'stays hidden'} for the rest of the mission`
  return `${name} ${next.kind === 'set' ? 'sets' : 'rises'} in ${fmtDuration(next.atS - tS)}`
}

/**
 * The mission planner screen: scenarios (site + date) → mission hardware → comparison, with
 * the horizon panorama, timelines, power and battery charts and the 3D view on one time cursor.
 */
export function MissionApp() {
  const [loaded, setLoaded] = useState<LoadedData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<MissionSettings>(DEFAULT_SETTINGS)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [show3d, setShow3d] = useState(true)
  // Result of the last "Copy link", for the link it copied; a changed comparison clears it.
  const [copyResult, setCopyResult] = useState<{ hash: string; ok: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadAllData()
      .then((data) => {
        if (cancelled) return
        const siteIds = data.sites.sites.map((s) => s.id)
        // A shared link (#s=...) opens the comparison it describes; otherwise the demo default.
        const shared = decodeShare(window.location.hash, (id) => isKnownSiteId(id, data.bySite))
        const initial = shared?.scenarios ?? defaultScenarios(siteIds)
        if (shared) setSettings(shared.settings)
        setLoaded(data)
        setScenarios(initial)
        setActiveKey(initial[shared?.active ?? 0]?.key ?? null)
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the address bar in step with the comparison, so the link can be copied at any time.
  const shareHash = loaded && scenarios.length ? encodeShare({ scenarios, active: Math.max(0, scenarios.findIndex((s) => s.key === activeKey)), settings }) : null
  useEffect(() => {
    if (shareHash && window.location.hash !== shareHash) window.history.replaceState(null, '', shareHash)
  }, [shareHash])
  const copied = copyResult && copyResult.hash === shareHash ? (copyResult.ok ? 'done' : 'failed') : 'idle'
  const copyLink = () => {
    const hash = shareHash ?? ''
    const done = (ok: boolean) => setCopyResult({ hash, ok })
    if (!navigator.clipboard) return done(false)
    navigator.clipboard.writeText(window.location.href).then(
      () => done(true),
      () => done(false),
    )
  }

  const issues = useMemo(() => validateSettings(settings), [settings])
  const outcomes = useMemo(() => (loaded && issues.length === 0 ? evaluateAll(scenarios, settings, loaded.bySite) : []), [loaded, scenarios, settings, issues])
  const evaluated = useMemo(() => outcomes.filter(isEvaluated), [outcomes])
  const activeIndex = Math.max(0, scenarios.findIndex((s) => s.key === activeKey))
  const active = outcomes[activeIndex] && isEvaluated(outcomes[activeIndex]) ? outcomes[activeIndex] : evaluated[0]
  const activeColor = COLORS[active ? outcomes.indexOf(active) : 0]
  const activeData = active && loaded ? loaded.bySite[active.scenario.siteId] : null
  const colorsOfEvaluated = evaluated.map((o) => COLORS[outcomes.indexOf(o)])

  const lastStep = evaluated.length ? evaluated[0].result.count - 1 : 0
  const k = Math.min(step, lastStep)
  useEffect(() => {
    if (!playing || lastStep === 0) return
    let frame = requestAnimationFrame(function tick() {
      setStep((s) => (s + STEPS_PER_FRAME > lastStep ? 0 : s + STEPS_PER_FRAME))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, lastStep])

  // Mission tracks of the active scenario (panorama + 3D).
  const tracks = useMemo(() => {
    if (!active || !activeData) return null
    const { startIndex, count } = active.result
    const slice = (v: number[]) => v.slice(startIndex, startIndex + count)
    const { sun, earth } = activeData.ephemeris
    const sunPath = { azDeg: slice(sun.azDeg), elDeg: slice(sun.elDeg), visible: active.result.sunVisible }
    const earthPath = { azDeg: slice(earth.azDeg), elDeg: slice(earth.elDeg), visible: active.result.earthVisible }
    return { sunPath, earthPath, sunDist: slice(sun.distanceM), earthDist: slice(earth.distanceM) }
  }, [active, activeData])

  const now = useMemo(() => {
    if (!active || !tracks) return null
    const kk = Math.min(k, active.result.count - 1)
    const sun: BodyState = { azDeg: tracks.sunPath.azDeg[kk], elDeg: tracks.sunPath.elDeg[kk], distanceM: tracks.sunDist[kk], visible: active.result.sunVisible[kk] }
    const earth: BodyState = { azDeg: tracks.earthPath.azDeg[kk], elDeg: tracks.earthPath.elDeg[kk], distanceM: tracks.earthDist[kk], visible: active.result.earthVisible[kk] }
    return { sun, earth, kk, tS: kk * active.result.stepS }
  }, [active, tracks, k])

  const panel = useMemo<PanelState>(
    () => ({ mode: settings.panelMode, areaM2: settings.panelAreaM2, fixedNormalAzDeg: settings.fixedNormalAzDeg, fixedNormalElDeg: settings.fixedNormalElDeg }),
    [settings.panelMode, settings.panelAreaM2, settings.fixedNormalAzDeg, settings.fixedNormalElDeg],
  )

  const socSeries = useMemo(
    () => evaluated.map((o) => ({ label: `${o.letter} · ${o.scenario.siteId}`, color: COLORS[outcomes.indexOf(o)], values: Array.from(o.result.socJ, (j) => (100 * j) / o.result.batteryCapacityJ) })),
    [evaluated, outcomes], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const socMarkers = evaluated
    .filter((o) => o.result.summary.firstReserveViolationS !== null)
    .map((o) => {
      const idx = Math.round((o.result.summary.firstReserveViolationS ?? 0) / o.result.stepS)
      return { index: idx, value: (100 * o.result.socJ[idx]) / o.result.batteryCapacityJ, color: COLORS[outcomes.indexOf(o)], label: `${o.letter}: below reserve at T+${Math.round(idx * o.result.stepS / 360) / 10} h` }
    })
  const powerMax = active ? Math.max(100, ...Array.from(active.result.generationW), ...Array.from(active.result.loadW)) : 100

  const header = (
    <header className="app__header">
      <div>
        <h1>Lunar Landing Site Navigator</h1>
        <p>Sun, Earth and terrain at lunar south-pole sites: power, battery and line of sight to Earth, compared with the same hardware.</p>
      </div>
      <span className="app__badge">Static app · NASA data pre-computed · no server</span>
    </header>
  )

  if (loadError)
    return (
      <div className="app">
        {header}
        <p className="app__message" role="alert">
          Could not load the site data ({loadError}). The files in <code>public/data/</code> are missing or incomplete: pull <code>main</code> or run the preprocessing.
        </p>
      </div>
    )
  if (!loaded)
    return (
      <div className="app">
        {header}
        <p className="app__message">Loading site data…</p>
      </div>
    )

  return (
    <div className="app">
      {header}
      <div className="app__layout">
        <aside className="app__side">
          <section className="card">
            <h2>
              <span className="step">1–2</span> Sites &amp; dates
            </h2>
            <ScenarioList
              sites={loaded.sites}
              scenarios={scenarios}
              outcomes={outcomes}
              colors={COLORS}
              activeKey={active?.scenario.key ?? activeKey}
              onChange={(next) => {
                setScenarios(next)
                if (!next.some((s) => s.key === activeKey)) setActiveKey(next[0]?.key ?? null)
              }}
              onActivate={setActiveKey}
            />
          </section>
          <section className="card">
            <h2>
              <span className="step">3</span> Mission hardware
            </h2>
            <SettingsForm settings={settings} issues={issues} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} onReset={() => setSettings(DEFAULT_SETTINGS)} />
          </section>
        </aside>

        <main className="app__main">
          <section className="card">
            <div className="card__head">
              <h2>
                <span className="step">4</span> Compare
              </h2>
              <button type="button" onClick={copyLink} title="Copy a link that opens this comparison (sites, dates and hardware)">
                {copied === 'done' ? 'Link copied' : 'Copy link'}
              </button>
            </div>
            {copied === 'failed' && (
              <p className="small muted">
                Copying is blocked in this browser; copy the address bar instead, it already holds this comparison.
              </p>
            )}
            {issues.length > 0 ? <p className="bad">Fix the mission hardware values to see results.</p> : <Comparison outcomes={outcomes} settings={settings} bySite={loaded.bySite} colors={COLORS} />}
          </section>

          {active && now && activeData && tracks && (
            <>
              <div className="timebar">
                <button type="button" onClick={() => setPlaying((p) => !p)}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <input type="range" min={0} max={lastStep} value={k} aria-label="Time in mission" onChange={(e) => setStep(Number(e.target.value))} />
                <span className="timebar__time">
                  T+{fmtDuration(now.tS)} · <b style={{ color: activeColor }}>{active.letter}</b> {fmtUtc(Date.parse(active.result.alignedStartUtc) + now.tS * 1000)}
                </span>
              </div>

              <section className="card">
                <h2>
                  Horizon panorama — <span style={{ color: activeColor }}>Scenario {active.letter}</span>, {activeData.site.id} {activeData.site.name}
                </h2>
                <Panorama horizon={activeData.horizon} sun={tracks.sunPath} earth={tracks.earthPath} k={now.kk} />
                <p className="muted small">
                  Grey = real terrain horizon from LOLA DEMs (out to 250 km, lunar curvature included); dashed line = flat horizon. Solid track = centre above the terrain horizon, dotted = hidden. Dot = now.{' '}
                  {countdown('Sun', active.result.sunWindows, now.sun.visible, now.tS)} · {countdown('Earth', active.result.earthWindows, now.earth.visible, now.tS)}.
                </p>
              </section>

              <section className="card">
                <h2>Sun and Earth in view</h2>
                <Timelines outcomes={evaluated} colors={colorsOfEvaluated} k={k} />
              </section>

              <section className="card">
                <h2>Battery state of charge</h2>
                <LineChart
                  series={socSeries}
                  stepH={active.result.stepS / 3600}
                  yMin={0}
                  yMax={100}
                  yUnit=" %"
                  refLines={[{ value: settings.reserveFraction * 100, label: `reserve ${Math.round(settings.reserveFraction * 100)} %` }]}
                  markers={socMarkers}
                  k={k}
                  ariaLabel="Battery state of charge of every scenario"
                />
              </section>

              <section className="card">
                <h2>
                  Panel output and demand — <span style={{ color: activeColor }}>Scenario {active.letter}</span>
                </h2>
                <LineChart
                  series={[
                    { label: 'Panel output (W)', color: '#ffd166', values: active.result.generationW },
                    { label: 'Demand (W)', color: '#ef6f6c', values: active.result.loadW, dashed: true },
                  ]}
                  stepH={active.result.stepS / 3600}
                  yMin={0}
                  yMax={Math.ceil(powerMax / 50) * 50}
                  yUnit=" W"
                  k={k}
                  ariaLabel="Panel output and demand of the active scenario"
                />
                <p className="muted small">
                  Now: panel {Math.round(active.result.generationW[now.kk])} W · demand {Math.round(active.result.loadW[now.kk])} W · battery{' '}
                  {Math.round((100 * active.result.socJ[now.kk]) / active.result.batteryCapacityJ)} % ({(active.result.socJ[now.kk] / J_PER_WH / 1000).toFixed(2)} kWh)
                </p>
              </section>

              <section className="card">
                <div className="card__head">
                  <h2>
                    3D view — <span style={{ color: activeColor }}>Scenario {active.letter}</span>
                  </h2>
                  <label className="field--check">
                    <input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> Show
                  </label>
                </div>
                {show3d && (
                  <div className="scene-box">
                    <MissionScene3D
                      terrain={activeData.terrain}
                      horizon={activeData.horizon}
                      sun={now.sun}
                      earth={now.earth}
                      sunPath={tracks.sunPath}
                      earthPath={tracks.earthPath}
                      panel={panel}
                      observerHeightM={activeData.site.observerHeightM}
                      surfaceElevationM={activeData.site.surfaceElevationM}
                    />
                  </div>
                )}
              </section>

              <section className="card">
                <h2>
                  Around the site (±{activeData.map ? activeData.map.grid.halfSizeM / 1000 : 3} km) — {activeData.site.id}
                </h2>
                {activeData.map ? (
                  <SiteMap map={activeData.map} sites={loaded.sites.sites} />
                ) : (
                  <p className="muted small">No regional map for this point{activeData.site.category === 'contrast' ? ' (contrast points have none)' : ''}.</p>
                )}
              </section>

              <section className="card">
                <h2>Through the year — {activeData.site.id}</h2>
                {activeData.season ? (
                  <SeasonChart season={activeData.season} missionStartUtc={active.result.alignedStartUtc} />
                ) : (
                  <p className="muted small">No one-year summary for this site.</p>
                )}
              </section>

              <section className="card">
                <h2>Sources and model</h2>
                <Sources data={activeData} result={active.result} />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
