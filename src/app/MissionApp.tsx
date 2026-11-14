import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LoadedData } from '../data/contract.ts'
import { loadAllData } from '../data/load.ts'
import { MissionScene3D } from '../scene3d/index.ts'
import type { BodyState, PanelState } from '../scene3d/index.ts'
import { earthOrientationAt, earthSunDirectionAt } from '../scene3d/appearance.ts'
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
import { decodeShare, encodeShare } from './share.ts'
import { Sources } from './Sources.tsx'
import { Timelines } from './Timelines.tsx'
import { Tour } from './Tour.tsx'
import type { TourStep } from './Tour.tsx'
import './app.css'

type Tab = 'sky' | 'power' | 'map' | 'year' | 'sources'
const TABS: { key: Tab; label: string }[] = [
  { key: 'sky', label: 'Sky view' },
  { key: 'power', label: 'Battery' },
  { key: 'map', label: 'Area map' },
  { key: 'year', label: 'Through the year' },
  { key: 'sources', label: 'Data & limits' },
]

const TOUR_SEEN_KEY = 'lsn-tour-seen'
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Storage blocked (private window): the tour simply shows again next time.
  }
}

/** Scenario colours A, B, C (distinct on the dark background and for common colour blindness). */
const COLORS = ['#f2a541', '#4cc9f0', '#c77dff']
const STEPS_PER_FRAME = 2

/** "in view, sets in 5 d 20 h" / "hidden for the rest of the mission". */
function countdown(windows: VisibilityWindow[], visibleNow: boolean, tS: number): string {
  const next = nextTransition(windows, tS)
  const now = visibleNow ? 'in view' : 'hidden'
  if (!next) return `${now} for the rest of the mission`
  return `${now}, ${next.kind === 'set' ? 'sets' : 'rises'} in ${fmtDuration(next.atS - tS)}`
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
  const [tab, setTab] = useState<Tab>('sky')
  const [tourOpen, setTourOpen] = useState(false)
  const diagnostics = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diagnostics') === '1'
  // Result of the last "Copy link", for the link it copied; a changed comparison clears it.
  const [copyResult, setCopyResult] = useState<{ hash: string; ok: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadAllData()
      .then((data) => {
        if (cancelled) return
        const siteIds = data.sites.sites.map((s) => s.id)
        // A shared link (#s=...) opens the comparison it describes; otherwise the demo default.
        const shared = decodeShare(window.location.hash, siteIds)
        const initial = shared?.scenarios ?? defaultScenarios(siteIds)
        if (shared) setSettings(shared.settings)
        setLoaded(data)
        setScenarios(initial)
        setActiveKey(initial[shared?.active ?? 0]?.key ?? null)
        // First visit (and not opened from a shared link): show the short tour once.
        if (!shared && !readFlag(TOUR_SEEN_KEY)) setTourOpen(true)
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
    const tS = kk * active.result.stepS
    const utc = new Date(Date.parse(active.result.alignedStartUtc) + tS * 1000).toISOString()
    return { sun, earth, kk, tS, utc }
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
      return { index: idx, value: (100 * o.result.socJ[idx]) / o.result.batteryCapacityJ, color: COLORS[outcomes.indexOf(o)], label: `${o.letter}: below reserve on day ${Math.floor((idx * o.result.stepS) / 86400) + 1}` }
    })
  const powerMax = active ? Math.max(100, ...Array.from(active.result.generationW), ...Array.from(active.result.loadW)) : 100

  const tourSteps: TourStep[] = [
    {
      title: 'Where should a Moon lander go?',
      body: "Near the Moon's south pole the Sun and Earth stay low on the horizon, so a hill or a crater rim can hide them. This tool checks two things for a landing spot: does the lander get enough sunlight for power, and can it see Earth to send data home?",
    },
    { target: 'places', title: '1. Pick places to compare', body: 'Choose up to three landing spots or start dates. Each one keeps its letter and colour (A, B, C) everywhere on the page.' },
    { target: 'result', title: '2. Read the answer', body: 'Each card answers the two questions. A green tick means the goal is met, a red cross means it is not. The bars show how much of the time the Sun and Earth are in view.' },
    {
      target: 'tabs',
      title: '3. See why',
      body: 'These tabs show the reason behind the answer: the skyline the lander sees, the battery over time, a map of the area and how things change through the year.',
      before: () => setTab('sky'),
    },
    { target: 'timebar', title: 'Move through time', body: 'Press Play or drag the slider. The skyline, the timelines and the 3D view all follow the same moment.', before: () => setTab('sky') },
    { target: 'settings', title: 'Change the lander', body: 'Open the lander settings to try a bigger battery, more solar panel or a longer mission. Every place is checked again instantly.' },
    { target: 'share', title: 'Share what you found', body: 'Copy link saves this exact comparison. Anyone who opens the link sees the same places, dates and settings.' },
  ]
  const closeTour = () => {
    setTourOpen(false)
    writeFlag(TOUR_SEEN_KEY)
  }

  const header = (
    <header className="app__header">
      <div className="app__title">
        <h1>Lunar Landing Site Navigator</h1>
        <p>Compare landing spots near the Moon&rsquo;s south pole: will the lander have power, and can it talk to Earth?</p>
      </div>
      <button type="button" className="app__help" onClick={() => setTourOpen(true)}>
        <span aria-hidden>?</span> How it works
      </button>
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
        <p className="app__message">Loading Moon terrain and Sun and Earth positions…</p>
      </div>
    )

  const days = `${settings.durationDays} ${settings.durationDays === 1 ? 'day' : 'days'}`
  const settingsSummary = `${days}, ${settings.panelAreaM2} m² solar panel, ${settings.batteryCapacityWh / 1000} kWh battery`
  const timebar = active && now && (
    <div className="timebar" data-tour="timebar">
      <button type="button" className="primary" onClick={() => setPlaying((p) => !p)}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input type="range" min={0} max={lastStep} value={k} aria-label="Time in mission" onChange={(e) => setStep(Number(e.target.value))} />
      <span className="timebar__time">
        Day {Math.floor(now.tS / 86400) + 1}, {fmtUtc(Date.parse(active.result.alignedStartUtc) + now.tS * 1000)}
      </span>
    </div>
  )

  return (
    <div className="app">
      {header}
      <Tour steps={tourSteps} open={tourOpen} onClose={closeTour} />
      <div className="app__layout">
        <aside className="app__side">
          <section className="card" data-tour="places">
            <h2>
              <span className="step">1</span> Pick places to compare
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
          <section className="card" data-tour="settings">
            <details className="settings-box" open={issues.length > 0 || undefined}>
              <summary>
                <span className="settings-box__title">
                  <span className="step">2</span> Lander settings <span className="muted small">(optional)</span>
                </span>
                <span className="muted small">{settingsSummary}</span>
              </summary>
              <SettingsForm settings={settings} issues={issues} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} onReset={() => setSettings(DEFAULT_SETTINGS)} />
            </details>
          </section>
        </aside>

        <main className="app__main">
          <section className="card" data-tour="result">
            <div className="card__head">
              <h2>
                <span className="step">3</span> Result
              </h2>
              <button type="button" onClick={copyLink} data-tour="share" title="Copy a link that opens this comparison (places, dates and lander settings)">
                {copied === 'done' ? 'Link copied' : 'Copy link'}
              </button>
            </div>
            {copied === 'failed' && <p className="small muted">This browser blocked copying. Copy the address bar instead; it already holds this comparison.</p>}
            {issues.length > 0 ? (
              <p className="bad">Some lander settings are out of range. Fix them in step 2 to see the result.</p>
            ) : (
              <Comparison outcomes={outcomes} settings={settings} bySite={loaded.bySite} colors={COLORS} />
            )}
          </section>

          {active && now && activeData && tracks && (
            <section className="card explore">
              <h2>See why</h2>
              <div className="explore__head">
                <div className="tabs" role="tablist" aria-label="See why" data-tour="tabs">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      id={`tab-${t.key}`}
                      aria-selected={tab === t.key}
                      aria-controls="tabpanel"
                      className={tab === t.key ? 'is-on' : undefined}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {evaluated.length > 1 && tab !== 'power' && (
                  <div className="explore__which" role="group" aria-label="Place shown">
                    <span className="muted small">Showing</span>
                    {evaluated.map((o) => (
                      <button
                        key={o.scenario.key}
                        type="button"
                        className={`chip${o === active ? ' is-on' : ''}`}
                        style={{ '--chip': COLORS[outcomes.indexOf(o)] } as CSSProperties}
                        aria-pressed={o === active}
                        onClick={() => setActiveKey(o.scenario.key)}
                      >
                        {o.letter}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="explore__panel">
                {tab === 'sky' && (
                  <>
                    <p className="explain">
                      The grey shape is the real skyline around the lander. Behind it, the <b className="sun">Sun</b> gives no power and <b className="earth">Earth</b> cannot be reached.
                    </p>
                    {timebar}
                    <h3>
                      Skyline at <span style={{ color: activeColor }}>{active.letter}</span>, {activeData.site.name}
                    </h3>
                    <Panorama horizon={activeData.horizon} sun={tracks.sunPath} earth={tracks.earthPath} k={now.kk} />
                    <p className="status">
                      <span className={now.sun.visible ? 'ok' : 'bad'}>
                        <b>Sun</b> {countdown(active.result.sunWindows, now.sun.visible, now.tS)}
                      </span>
                      <span className={now.earth.visible ? 'ok' : 'bad'}>
                        <b>Earth</b> {countdown(active.result.earthWindows, now.earth.visible, now.tS)}
                      </span>
                    </p>
                    <h3>In view during the mission</h3>
                    <Timelines outcomes={evaluated} colors={colorsOfEvaluated} k={k} />
                    <div className="card__head">
                      <h3>3D view</h3>
                      <label className="field--check">
                        <input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> Show
                      </label>
                    </div>
                    {show3d && (
                      <div className="scene-box">
                        <MissionScene3D
                          terrain={activeData.terrain}
                          farTerrain={activeData.terrainFar}
                          horizon={activeData.horizon}
                          sun={now.sun}
                          earth={now.earth}
                          sunPath={tracks.sunPath}
                          earthPath={tracks.earthPath}
                          earthOrientation={earthOrientationAt(activeData.earthOrientation, now.utc)}
                          earthSunDirection={earthSunDirectionAt(activeData.earthOrientation, now.utc)}
                          panelPowerW={active.result.generationW[now.kk]}
                          diagnostics={diagnostics}
                          panel={panel}
                          observerHeightM={activeData.site.observerHeightM}
                          surfaceElevationM={activeData.site.surfaceElevationM}
                        />
                      </div>
                    )}
                  </>
                )}

                {tab === 'power' && (
                  <>
                    <p className="explain">The panel charges the battery while the Sun is up. Below the red dashed line the lander is into its safety reserve.</p>
                    {timebar}
                    <h3>Battery charge</h3>
                    <LineChart
                      series={socSeries}
                      stepH={active.result.stepS / 3600}
                      yMin={0}
                      yMax={100}
                      yUnit=" %"
                      refLines={[{ value: settings.reserveFraction * 100, label: `safety reserve ${Math.round(settings.reserveFraction * 100)} %` }]}
                      markers={socMarkers}
                      k={k}
                      ariaLabel="Battery charge of every place"
                    />
                    <h3>
                      Power in and out at <span style={{ color: activeColor }}>{active.letter}</span>
                    </h3>
                    <LineChart
                      series={[
                        { label: 'Solar panel output (W)', color: '#ffd166', values: active.result.generationW },
                        { label: 'Power used (W)', color: '#ef6f6c', values: active.result.loadW, dashed: true },
                      ]}
                      stepH={active.result.stepS / 3600}
                      yMin={0}
                      yMax={Math.ceil(powerMax / 50) * 50}
                      yUnit=" W"
                      k={k}
                      ariaLabel="Solar panel output and power used"
                    />
                  </>
                )}

                {tab === 'map' && (
                  <>
                    <p className="explain">Every spot within {activeData.map ? activeData.map.grid.halfSizeM / 1000 : 3} km. Brighter means more time in view. Click a spot to read it.</p>
                    {activeData.map ? (
                      <SiteMap map={activeData.map} sites={loaded.sites.sites} />
                    ) : (
                      <p className="muted">
                        No area map here{activeData.site.category === 'contrast' ? ': this is a comparison point away from the pole' : ''}. Pick a south-pole site to see one.
                      </p>
                    )}
                  </>
                )}

                {tab === 'year' && (
                  <>
                    <p className="explain">Sunlight at the pole changes a lot with the season. One point per month.</p>
                    {activeData.season ? (
                      <SeasonChart season={activeData.season} missionStartUtc={active.result.alignedStartUtc} />
                    ) : (
                      <p className="muted">No one-year summary for this place.</p>
                    )}
                  </>
                )}

                {tab === 'sources' && (
                  <>
                    <Sources data={activeData} result={active.result} />
                  </>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
