import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LoadedData, SiteData, SiteEntry } from '../data/contract.ts'
import { loadCells, loadYear } from '../data/extended.ts'
import { loadAllData } from '../data/load.ts'
import { MissionScene3D } from '../scene3d/index.ts'
import { SceneMissionControls } from '../scene3d/SceneMissionControls.tsx'
import { SceneMissionSummary } from '../scene3d/SceneMissionSummary.tsx'
import type { BodyState, PanelState } from '../scene3d/index.ts'
import type { TerrainGrid } from '../scene3d/types.ts'
import { earthOrientationAt, earthOrientationCoverageWarning, earthSunDirectionAt } from '../scene3d/appearance.ts'
import { DEFAULT_SETTINGS, validateSettings } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { nextTransition } from '../sim/visibility.ts'
import type { VisibilityWindow } from '../sim/visibility.ts'
import { LineChart } from './charts/LineChart.tsx'
import { SkyVisibilityChart } from './charts/SkyVisibilityChart.tsx'
import { SeasonChart } from './charts/SeasonChart.tsx'
import { SiteMap } from './charts/SiteMap.tsx'
import { RimlightMark } from './Brand.tsx'
import { Comparison } from './Comparison.tsx'
import { Landing } from './Landing.tsx'
import { mapPointWhere, placeTitle } from './placeName.ts'
import { errorMessage, fmtDuration, fmtHours, fmtUtc } from './format.ts'
import { cellId, isKnownSiteId, parseCellId, resolveSiteData, sitesNeeded } from './extendedSites.ts'
import type { ExtendedState } from './extendedSites.ts'
import { cellAt } from './mapGrid.ts'
import { defaultScenarios, evaluateAll, isEvaluated, newKey, targetScenarioKey } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import { ResearchView } from './ResearchView.tsx'
import { SettingsForm } from './SettingsForm.tsx'
import { decodeShare, encodeShare } from './share.ts'
import { Sources } from './Sources.tsx'
import { Timelines } from './Timelines.tsx'
import { Tour } from './Tour.tsx'
import type { TourStep } from './Tour.tsx'
import { MissionFooter } from './MissionFooter.tsx'
import { PageNavigation } from './PageNavigation.tsx'
import type { View } from './PageNavigation.tsx'
import type { MoonFlight } from './MoonGlobe.tsx'
import { prepareSceneTerrain } from '../scene3d/terrainCache.ts'
import './app.css'

const MoonGlobe = lazy(() => import('./MoonGlobe.tsx'))

type Tab = 'sky' | 'research' | 'power' | 'map' | 'year' | 'sources'
const TABS: { key: Tab; label: string }[] = [
  { key: 'sky', label: 'Sky view' },
  { key: 'research', label: 'Research' },
  { key: 'power', label: 'Battery' },
  { key: 'map', label: 'Area map' },
  { key: 'year', label: 'Through the year' },
  { key: 'sources', label: 'Data & limits' },
]

/** `?view=` in the address; a shared comparison link without it opens the results. */
function viewFromLocation(): View {
  const v = new URLSearchParams(window.location.search).get('view')
  if (v === 'simulation' || v === 'results') return v
  return /(^#|&)s=/.test(window.location.hash) ? 'results' : 'home'
}

/** Scenario colours A, B, C (distinct on the dark background and for common colour blindness). */
const COLORS = ['#7a5be0', '#3a9468', '#cc6cbb']
const STEPS_PER_FRAME = 2

/** "the same point" / "200 m east, 600 m north of it". */
function cellOffset(map: Parameters<typeof cellAt>[0], row: number, col: number): string {
  const c = cellAt(map, row, col)
  if (c.distanceM === 0) return 'the same point'
  return `${fmtM(Math.abs(c.eastM))} ${c.eastM >= 0 ? 'east' : 'west'}, ${fmtM(Math.abs(c.northM))} ${c.northM >= 0 ? 'north' : 'south'} of it`
}
const fmtM = (m: number) => (Math.abs(m) < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

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
  const [view, setView] = useState<View>(viewFromLocation)
  const [simulationStage, setSimulationStage] = useState<'pick' | 'watch'>('pick')
  const [simulationStarted, setSimulationStarted] = useState(false)
  const [preparedPickKey, setPreparedPickKey] = useState('')
  const [readyTerrain, setReadyTerrain] = useState<TerrainGrid | null>(null)
  const [picked, setPicked] = useState<Scenario[]>([])
  const [flight, setFlight] = useState<(MoonFlight & { targetKey: string }) | null>(null)
  const [transitionId, setTransitionId] = useState(0)
  const transitionAction = useRef<(() => void) | null>(null)
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    if (!transitionId) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const swap = window.setTimeout(() => transitionAction.current?.(), reduced ? 80 : 320)
    const finish = window.setTimeout(() => setCovered(false), reduced ? 200 : 800)
    return () => { clearTimeout(swap); clearTimeout(finish) }
  }, [transitionId])
  const darken = (action: () => void) => {
    setPlaying(false)
    transitionAction.current = action
    setCovered(true)
    setTransitionId(id => id + 1)
  }
  const [mapUpdate, setMapUpdate] = useState<{ key: string; siteId: string; previous: string } | null>(null)
  const [tab, setTab] = useState<Tab>('sky')
  const [tourOpen, setTourOpen] = useState(false)
  const diagnostics = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diagnostics') === '1'
  // Result of the last "Copy link", for the link it copied; a changed comparison clears it.
  const [copyResult, setCopyResult] = useState<{ hash: string; ok: boolean } | null>(null)
  // One-year series and map-point horizons, fetched per site after the first render.
  const [ext, setExt] = useState<ExtendedState>({ years: {}, cells: {} })

  const pickKey = picked.map(place => `${place.key}:${place.siteId}`).join(',')
  useEffect(() => {
    if (!loaded || !picked.length || view !== 'simulation' || simulationStage !== 'pick') return
    let cancelled = false
    void import('../scene3d/SceneCanvas.tsx').catch(() => { /* The scene boundary offers retry on failure. */ })
    void Promise.all(picked.map(place => {
      const data = loaded.bySite[place.siteId]
      return data?.terrain ? prepareSceneTerrain(data.terrain, data.terrainFar, data.site.observerHeightM) : Promise.resolve()
    })).then(() => {
      if (cancelled) return
      setScenarios(picked)
      setActiveKey(picked[0].key)
      setPreparedPickKey(pickKey)
      setSimulationStarted(true)
    })
    return () => { cancelled = true }
  }, [loaded, picked, pickKey, view, simulationStage])

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
    if (view !== 'home' && shareHash && window.location.hash !== shareHash) window.history.replaceState(null, '', shareHash)
  }, [shareHash, view])

  // Page changes go into the browser history, so Back and Forward work.
  const go = useCallback((next: View) => {
    const url = new URL(window.location.href)
    if (next === 'home') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    window.history.pushState(null, '', `${url.pathname}${url.search}${next === 'home' ? '' : url.hash}`)
    setView(next)
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onPop = () => setView(viewFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
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

  // Which per-site files to fetch: what the scenarios need now, plus (in the background) the
  // one-year series of every scenario's site so later dates open without waiting.
  const wanted = useMemo(() => {
    if (!loaded) return { years: [] as string[], cells: [] as string[] }
    const need = sitesNeeded(scenarios, loaded.sites.coverage.endUtc, settings.durationDays)
    const bases = scenarios.map((s) => parseCellId(s.siteId)?.siteId ?? s.siteId).filter((id) => id in loaded.bySite)
    return { years: [...new Set([...need.years, ...bases])], cells: need.cells }
  }, [loaded, scenarios, settings.durationDays])
  const wantedKey = `${wanted.years.join(',')}|${wanted.cells.join(',')}`
  useEffect(() => {
    const years = wanted.years.filter((id) => ext.years[id] === undefined)
    const cells = wanted.cells.filter((id) => ext.cells[id] === undefined)
    if (years.length === 0 && cells.length === 0) return
    const mark = (kind: 'years' | 'cells', id: string, value: ExtendedState['years'][string] | ExtendedState['cells'][string]) =>
      setExt((e) => ({ ...e, [kind]: { ...e[kind], [id]: value } }))
    for (const id of years) {
      mark('years', id, 'loading')
      loadYear(id).then(
        (y) => mark('years', id, y),
        () => mark('years', id, 'error'),
      )
    }
    for (const id of cells) {
      mark('cells', id, 'loading')
      loadCells(id).then(
        (c) => mark('cells', id, c),
        () => mark('cells', id, 'error'),
      )
    }
  }, [wantedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = useCallback(
    (id: string, startUtc: string) =>
      loaded ? resolveSiteData(id, startUtc, loaded.sites.coverage.endUtc, loaded.bySite, ext, settings.durationDays) : { error: 'Site data not loaded.' },
    [loaded, ext, settings.durationDays],
  )
  const maxStartFor = useCallback((siteId: string) => {
    const year = ext.years[parseCellId(siteId)?.siteId ?? siteId]
    return year && year !== 'loading' && year !== 'error'
      ? new Date(Date.parse(year.startUtc) + (year.count - 1) * year.stepS * 1000).toISOString()
      : loaded?.sites.coverage.endUtc ?? ''
  }, [ext, loaded])
  const issues = useMemo(() => validateSettings(settings), [settings])
  const outcomes = useMemo(() => (loaded && issues.length === 0 ? evaluateAll(scenarios, settings, resolve) : []), [loaded, scenarios, settings, issues, resolve])
  const shownBySite = useMemo(() => {
    const out: Record<string, SiteData> = { ...(loaded?.bySite ?? {}) }
    for (const o of outcomes) if (o.data) out[o.data.site.id] = o.data
    return out
  }, [loaded, outcomes])
  const evaluated = useMemo(() => outcomes.filter(isEvaluated), [outcomes])
  const activeIndex = Math.max(0, scenarios.findIndex((s) => s.key === activeKey))
  const active = outcomes[activeIndex] && isEvaluated(outcomes[activeIndex]) ? outcomes[activeIndex] : view === 'simulation' && simulationStage === 'watch' ? undefined : evaluated[0]
  const activeColor = COLORS[active ? outcomes.indexOf(active) : 0]
  const activeData = active?.data ?? null
  const activeCell = activeData ? parseCellId(activeData.site.id) : null
  // Map-point actions and the highlight stay on the chosen scenario, also while it loads.
  const chosenKey = targetScenarioKey(scenarios, activeKey)
  const chosenOutcome = outcomes.find((o) => o.scenario.key === chosenKey)
  const chosenScenario = scenarios.find(s => s.key === chosenKey)
  const chosenLoading = !!chosenOutcome?.loading
  const patchSceneScenario = (patch: Partial<Pick<Scenario, 'siteId' | 'startUtc'>>) => {
    setPlaying(false)
    setStep(0)
    setScenarios(list => list.map(s => s.key === chosenKey ? { ...s, ...patch } : s))
  }
  const setActiveSite = (siteId: string) => {
    const previous = scenarios.find(s => s.key === chosenKey)
    if (!previous) return
    setMapUpdate({ key: previous.key, siteId, previous: placeTitle(previous.siteId, shownBySite) })
    setPlaying(false)
    setScenarios(list => list.map(s => s.key === previous.key ? { ...s, siteId } : s))
  }
  const mapUpdateOutcome = mapUpdate && outcomes.find(o => o.scenario.key === mapUpdate.key && o.scenario.siteId === mapUpdate.siteId)

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
      title: 'Find the light before you land.',
      body: "Near the Moon's south pole the Sun and Earth stay low on the horizon, so a hill or a crater rim can hide them. The light is on the rim. Rimlight checks two things for a landing spot: does the lander get enough sunlight for power, and can it see Earth to send data home?",
    },
    { target: 'places', title: '1. Pick places to compare', body: 'Choose up to three labelled locations on the Moon, then press Show in simulation. Use the arrows to visit them in selection order.', before: () => go('simulation') },
    { target: 'scene', title: '2. Watch the simulation', body: 'The 3D view shows the real terrain around the lander, with the Sun and Earth where they really are. Drag to look around.', before: () => go('simulation') },
    { target: 'timebar', title: 'Move through time', body: 'Press Play or drag the slider to move through the mission. The line under the view says whether the Sun and Earth are in sight.', before: () => go('simulation') },
    {
      target: 'result',
      title: '3. Read the answer',
      body: 'On the results page each column answers the two questions: a tick means the goal is met, a red cross means it is not. No hidden score, just conditions.',
      before: () => go('results'),
    },
    {
      target: 'tabs',
      title: 'See why',
      body: 'These tabs show the reason behind the answer: the skyline the lander sees, the battery over time, a map of the area and how things change through the year.',
      before: () => {
        go('results')
        setTab('sky')
      },
    },
    { target: 'settings', title: 'Change the lander', body: 'Open the lander settings to try a bigger battery, more solar panel or a longer mission. Every place is checked again instantly.', before: () => go('results') },
    { target: 'share', title: 'Share what you found', body: 'Copy link saves this exact comparison. Anyone who opens the link sees the same places, dates and settings.', before: () => go('results') },
  ]

  const header = (
    <header className="app__header">
      <div className="app__bar">
        <button type="button" className="brand brand--link" onClick={() => go('home')} aria-label="Rimlight, home">
          <RimlightMark size={36} />
          <span className="brand__text">
            <span className="brand__word">Rimlight</span>
            <span className="brand__desc">Lunar Landing Site Navigator</span>
          </span>
        </button>
        <PageNavigation view={view} onChange={go} />
        {/* Rendered on home too (hidden) so the page links keep the same position on every page. */}
        <button
          type="button"
          className={view === 'home' ? 'app__help is-placeholder' : 'app__help'}
          onClick={() => setTourOpen(true)}
          aria-label="How it works"
          title="How it works"
          aria-hidden={view === 'home' || undefined}
          tabIndex={view === 'home' ? -1 : undefined}
        >
          <span aria-hidden>?</span>
        </button>
      </div>
    </header>
  )
  const footer = (
    <MissionFooter
      onHome={() => go('home')}
      onSimulation={() => go('simulation')}
      onResults={() => go('results')}
      onSources={() => { setTab('sources'); go('results') }}
    />
  )

  if (view === 'home')
    return (
      <div className="app app--home">
        {header}
        <Landing horizon={loaded?.bySite.Site04R?.horizon ?? activeData?.horizon} onSimulation={() => go('simulation')} onResults={() => go('results')} />
        {footer}
      </div>
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

  const travelTo = (index: number) => {
    const target = scenarios[index]
    const from = activeData?.site
    const to = target && shownBySite[target.siteId]?.site
    if (!target || !from || !to || flight) return
    setPlaying(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      darken(() => setActiveKey(target.key))
      return
    }
    setFlight({ from, to, targetKey: target.key })
  }

  const days = `${settings.durationDays} ${settings.durationDays === 1 ? 'day' : 'days'}`
  const firstTerrain = picked[0] && loaded.bySite[picked[0].siteId]?.terrain
  const selectionReady = preparedPickKey === pickKey && (!active || !firstTerrain || readyTerrain === firstTerrain)
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
  const status = active && now && (
    <p className="status">
      <span className={now.sun.visible ? 'ok' : 'bad'}>
        <b>Sun</b> {countdown(active.result.sunWindows, now.sun.visible, now.tS)}
      </span>
      <span className={now.earth.visible ? 'ok' : 'bad'}>
        <b>Earth</b> {countdown(active.result.earthWindows, now.earth.visible, now.tS)}
      </span>
    </p>
  )
  const placeChips = evaluated.length > 1 && (
    <div className="explore__which" role="group" aria-label="Place shown">
      {evaluated.map((o) => (
        <button
          key={o.scenario.key}
          type="button"
          className={`chip${o === active ? ' is-on' : ''}`}
          style={{ '--chip': COLORS[outcomes.indexOf(o)] } as CSSProperties}
          aria-pressed={o === active}
          onClick={() => setActiveKey(o.scenario.key)}
        >
          {o.letter} {placeTitle(o.scenario.siteId, shownBySite)}
        </button>
      ))}
    </div>
  )
  const updateLocations = (next: Scenario[]) => {
    setPicked(next)
    setScenarios(next)
    setActiveKey(current => next.some(place => place.key === current) ? current : next[0]?.key ?? null)
  }

  const missionControls = <SceneMissionControls
    sites={loaded.sites} scenarios={scenarios} chosenKey={chosenKey}
    durationDays={settings.durationDays} endUtc={maxStartFor(chosenScenario?.siteId ?? loaded.sites.sites[0].id)}
    onChoose={key => { setPlaying(false); setStep(0); setActiveKey(key) }} onPatch={patchSceneScenario}
    onDuration={durationDays => { setPlaying(false); setStep(0); setSettings(previous => ({ ...previous, durationDays })) }}
    onCopy={() => { if (chosenScenario && scenarios.length < 3) { const copy = { ...chosenScenario, key: newKey() }; setScenarios([...scenarios, copy]); setActiveKey(copy.key); setPlaying(false); setStep(0) } }} />

  return (
    <div className="app">
      {header}
      {covered && <div key={transitionId} className="mission-blackout" aria-hidden="true" />}
      <Tour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} />
      {view === 'simulation' && (
        <div className="simulation-layout">
          <main className="app__main">
            <section className="card moon-picker" data-mode={flight ? 'flight' : simulationStage} aria-hidden={simulationStage !== 'pick' && !flight || undefined} inert={simulationStage !== 'pick' && !flight || undefined} data-tour="places">
              <div className="card__head"><div><h2>Choose places on the Moon</h2>
                <p className="card__tagline">Click a place name on the globe to add it. You can compare up to three places.</p></div></div>
              <div className="moon-picker__globe"><Suspense fallback={<p role="status">Loading the Moon&hellip;</p>}>
                <MoonGlobe active={simulationStage === 'pick' || !!flight} flight={flight ?? undefined} onComplete={() => { if (flight) { setActiveKey(flight.targetKey); setFlight(null) } }} sites={loaded.sites.sites} selected={(flight ? scenarios : picked).flatMap((s, i) => {
                  const site = shownBySite[s.siteId]?.site ?? loaded.sites.sites.find(site => site.id === s.siteId)
                  return site ? [{ key: s.key, site, letter: String.fromCharCode(65 + i), color: COLORS[i] }] : []
                })} onSelect={(site: SiteEntry) => updateLocations(picked.some(s => s.siteId === site.id)
                  ? picked.filter(s => s.siteId !== site.id)
                  : picked.length < 3 ? [...picked, { key: newKey(), siteId: site.id, startUtc: scenarios[0]?.startUtc ?? loaded.sites.coverage.startUtc }] : picked)} />
              </Suspense></div>
              {flight && <p className="sim__flight-label" role="status">{flight.from.name} <span aria-hidden="true">&rarr;</span> {flight.to.name}</p>}
              <div className="moon-picker__selection" aria-live="polite">
                {picked.length === 0 && <p className="muted">No place chosen yet. Click a name on the globe.</p>}
                {picked.map((s, i) => <div key={s.key} className="moon-choice" style={{ '--place-color': COLORS[i] } as CSSProperties}>
                  <span className="moon-choice__letter">{String.fromCharCode(65 + i)}</span>
                  <span>{placeTitle(s.siteId, shownBySite)}</span>
                  <button type="button" aria-label={`Remove ${placeTitle(s.siteId, loaded.bySite)}`} onClick={() => updateLocations(picked.filter(p => p.key !== s.key))}>&times;</button>
                </div>)}
              </div>
              <div className="moon-picker__actions"><button type="button" className="primary" disabled={picked.length < 2} onClick={() => { setScenarios(picked); setActiveKey(picked[0].key); setPlaying(false); setStep(0); go('results') }}>Compare selected points</button><span className="muted small">{picked.length} / 3 locations</span>
                <button type="button" className="primary" disabled={!picked.length || covered || !selectionReady} onClick={() => darken(() => {
                  setScenarios(picked); setActiveKey(picked[0].key); setStep(0); setSimulationStarted(true); setSimulationStage('watch')
                })}>{picked.length > 0 && !selectionReady ? 'Preparing terrain…' : 'Show in simulation'} <span aria-hidden="true">&nearr;</span></button></div>
            </section>
            {simulationStarted && <section className="card sim" hidden={simulationStage === 'pick'} inert={simulationStage === 'pick' || undefined}>
              <div className="sim__route">
                <button type="button" disabled={!!flight || covered} onClick={() => darken(() => { setPicked(scenarios); setActiveKey(scenarios[0]?.key ?? null); setSimulationStage('pick') })}>&larr; Edit locations</button>
                <div className="sim__route-nav" aria-label="Selected location navigation">
                  <button type="button" aria-label="Previous location" disabled={activeIndex === 0 || !!flight || covered} onClick={() => travelTo(activeIndex - 1)}>&larr;</button>
                  <span role="status" style={{ color: COLORS[activeIndex] }}>{String.fromCharCode(65 + activeIndex)} &middot; {placeTitle(scenarios[activeIndex]?.siteId ?? '', shownBySite)} <small>{activeIndex + 1} / {scenarios.length}</small></span>
                  <button type="button" aria-label="Next location" disabled={activeIndex >= scenarios.length - 1 || !!flight || covered} onClick={() => travelTo(activeIndex + 1)}>&rarr;</button>
                </div>
              </div>
              <div className="card__head">
                <div>
                  <h2>
                    <span className="step">2</span> Simulation
                    {active?.scenario.key === chosenKey && activeData && (
                      <>
                        {' '}
                        at <span style={{ color: activeColor }}>{active.letter}</span>, {placeTitle(activeData.site.id, shownBySite)}
                      </>
                    )}
                  </h2>
                  <p className="card__tagline">Choose a place and UTC start, then explore its terrain, sunlight and view of Earth.</p>
                </div>
              </div>
              {missionControls}
              {issues.length > 0 && <p className="bad">Check the mission duration here or the lander settings on Results to run the simulation.</p>}
              {active?.scenario.key === chosenKey && now && activeData && tracks ? (
                <>
                  <SceneMissionSummary result={active.result} settings={settings} />
                  {activeCell && activeData.map ? (
                    <div data-tour="scene">
                      <p className="muted">This grid point is {cellOffset(activeData.map, activeCell.row, activeCell.col)}. Its own 1° terrain horizon drives the calculation. A registered 3D patch is not available here; the chart shows this point's calculated visibility.</p>
                      <SkyVisibilityChart horizon={activeData.horizon} sun={tracks.sunPath} earth={tracks.earthPath} stepH={active.result.stepS / 3600} k={now.kk} />
                    </div>
                  ) : (
                    <div className="scene-box scene-box--large" data-tour="scene">
                      <MissionScene3D
                        onReady={() => { if (activeData.terrain) setReadyTerrain(activeData.terrain) }}
                        animateArrival={simulationStage === 'watch' && !flight}
                        terrain={activeData.terrain}
                        farTerrain={activeData.terrainFar}
                        horizon={activeData.horizon}
                        sun={now.sun}
                        earth={now.earth}
                        sunPath={tracks.sunPath}
                        earthPath={tracks.earthPath}
                        earthOrientation={earthOrientationAt(activeData.earthOrientation, now.utc)}
                        earthSunDirection={earthSunDirectionAt(activeData.earthOrientation, now.utc)}
                        earthDisplayWarning={earthOrientationCoverageWarning(activeData.earthOrientation, now.utc)}
                        panelPowerW={active.result.generationW[now.kk]}
                        diagnostics={diagnostics}
                        panel={panel}
                        observerHeightM={activeData.site.observerHeightM}
                        surfaceElevationM={activeData.site.surfaceElevationM}
                      />
                    </div>
                  )}
                  {timebar}
                  {status}
                  <details className="scene-summary"><summary>Angles, battery and power · details</summary>
                  <dl className="scene-mission__facts" aria-label="Selected mission facts">
                    <div><dt>Sun elevation · local horizontal</dt><dd>{now.sun.elDeg.toFixed(2)}°</dd><small>Sun centre above the terrain: {fmtHours(active.result.summary.sunVisibleFraction * active.result.durationS)} of this mission.</small></div>
                    <div><dt>Earth elevation · local horizontal</dt><dd>{now.earth.elDeg.toFixed(2)}°</dd><small>Direct view of Earth: {fmtHours(active.result.summary.earthVisibleFraction * active.result.durationS)}. Longest outage: {fmtDuration(active.result.summary.longestEarthOutageS)}.</small></div>
                    <div><dt>Battery now</dt><dd>{(100 * active.result.socJ[now.kk] / active.result.batteryCapacityJ).toFixed(1)}%</dd><small>Panel: {Math.round(active.result.generationW[now.kk])} W. {active.result.summary.keepsBatteryReserve ? 'Reserve protected throughout this mission.' : 'Battery falls below reserve during this mission.'}</small></div>
                  </dl>
                  </details>
                  <div className="sim__next">
                    <button type="button" className="primary" onClick={() => go('results')}>
                      See the results
                    </button>
                  </div>
                </>
              ) : (
                !issues.length && <p className="muted">{chosenOutcome?.error ?? 'Preparing the simulation…'}</p>
              )}
            </section>}
          </main>
        </div>
      )}

      {view === 'results' && mapUpdate && mapUpdateOutcome && (
        <aside className={`map-update${mapUpdateOutcome.error && !mapUpdateOutcome.loading ? ' map-update--error' : ''}`} aria-label="Landing location update">
          <button type="button" className="map-update__close" aria-label="Dismiss location update" onClick={() => setMapUpdate(null)}>&times;</button>
          <div role={mapUpdateOutcome.error && !mapUpdateOutcome.loading ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
            <strong>{mapUpdateOutcome.loading ? `Updating location ${mapUpdateOutcome.letter}...` : isEvaluated(mapUpdateOutcome) ? `Location ${mapUpdateOutcome.letter} updated` : 'Could not test this spot'}</strong>
            <p>{isEvaluated(mapUpdateOutcome)
              ? `${mapUpdate.previous} updated to ${mapPointWhere(mapUpdate.siteId, shownBySite) ?? placeTitle(mapUpdate.siteId, shownBySite)}`
              : mapUpdateOutcome.error ?? 'Recalculating power and Earth contact for this spot.'}</p>
            {isEvaluated(mapUpdateOutcome) && <p>Power and Earth contact recalculated. Map colors stay the same.</p>}
          </div>
          {isEvaluated(mapUpdateOutcome) && <div className="map-update__actions">
            <button type="button" onClick={() => {
              setActiveKey(mapUpdate.key)
              setMapUpdate(null)
              document.querySelector('[data-tour="result"]')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
            }}>View updated results</button>
            <button type="button" onClick={() => { setActiveKey(mapUpdate.key); setTab('sky'); setMapUpdate(null) }}>View sky chart</button>
          </div>}
        </aside>
      )}

      {view === 'results' && (
        <div className="results-layout">
          <main className="app__main">
            {missionControls}
            <section className="card" data-tour="settings">
              <details className="settings-box" open={issues.length > 0 || undefined}>
                <summary>
                  <span className="settings-box__title">
                    Lander settings
                  </span>
                  <span className="muted small">{settingsSummary}</span>
                </summary>
                <SettingsForm settings={settings} issues={issues} onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))} onReset={() => setSettings(DEFAULT_SETTINGS)} />
              </details>
            </section>

            <section className="card" data-tour="result">
              <div className="card__head">
                <div>
                  <h2>
                    Results
                  </h2>
                </div>
                <button type="button" onClick={copyLink} data-tour="share" title="Copy a link that opens this comparison (places, dates and lander settings)">
                  {copied === 'done' ? 'Link copied' : 'Copy link'}
                </button>
              </div>
              {copied === 'failed' && <p className="small muted">This browser blocked copying. Copy the address bar instead; it already holds this comparison.</p>}
              {issues.length > 0 ? (
                <p className="bad">Some lander settings are out of range. Open Lander settings above to fix them.</p>
              ) : (
                scenarios.length ? <Comparison outcomes={outcomes} settings={settings} bySite={shownBySite} colors={COLORS} /> : (
                  <div className="results-empty"><p>Choose locations to see your results.</p><button type="button" className="primary" onClick={() => go('simulation')}>Choose locations</button></div>
                )
              )}
            </section>

            {active && now && activeData && tracks && (
              <section className="card explore">
                <h2>Explore the results</h2>
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
                  {placeChips}
                </div>

                <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="explore__panel">
                  {tab === 'sky' && (
                    <>
                      <p className="explain">
                        Above the line: in view. Below it: hidden by the Moon.
                      </p>
                      {timebar}
                      <h3>
                        Sun &amp; Earth visibility
                      </h3>
                      <SkyVisibilityChart horizon={activeData.horizon} sun={tracks.sunPath} earth={tracks.earthPath} stepH={active.result.stepS / 3600} k={now.kk} />
                      {status}
                      <h3>In view during the mission</h3>
                      <Timelines outcomes={evaluated} colors={colorsOfEvaluated} k={k} />
                    </>
                  )}

                  {tab === 'research' && (
                    <ResearchView
                      data={activeData}
                      result={active.result}
                      startUtc={active.scenario.startUtc}
                      settings={settings}
                      catalogue={loaded.bySite}
                      psrs={loaded.psrs ?? []}
                      inScenarios={scenarios.map((s) => s.siteId)}
                      canAdd={scenarios.length < 3}
                      onCompare={(siteId) => {
                        if (scenarios.length < 3) {
                          const added = { key: newKey(), siteId, startUtc: active.scenario.startUtc }
                          setScenarios([...scenarios, added])
                          setPicked([...scenarios, added])
                        } else setActiveSite(siteId)
                      }}
                    />
                  )}

                  {tab === 'power' && (
                    <>
                      <p className="explain">Below the red dashed line the lander is into its safety reserve.</p>
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
                          { label: 'Power used (W)', color: '#aab3c2', values: active.result.loadW, dashed: true },
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
                      <p className="explain">Brighter means more time in view. Click a spot to test it.</p>
                      {activeData.map ? (
                        <SiteMap
                          map={activeData.map}
                          sites={loaded.sites.sites}
                          selected={activeCell ?? undefined}
                          onSimulate={(siteId, row, col) => setActiveSite(cellId(siteId, row, col))}
                          scenarioLabel={chosenOutcome?.letter}
                          busy={chosenLoading ? (chosenOutcome?.error ?? 'Loading…') : undefined}
                        />
                      ) : (
                        <p className="muted">
                          No area map here{activeData.site.category === 'contrast' ? ': this is a comparison point away from the pole' : ''}. Pick a south-pole site to see one.
                        </p>
                      )}
                    </>
                  )}

                  {tab === 'year' && (
                    <>
                      <p className="explain">One point per month.</p>
                      {activeData.season && !activeCell ? (
                        <SeasonChart season={activeData.season} missionStartUtc={active.result.alignedStartUtc} />
                      ) : (
                        <p className="muted">No monthly summary for this exact point. Mission results above use this point’s own horizon; the catalogue centre’s annual summary is not substituted.</p>
                      )}
                    </>
                  )}

                  {tab === 'sources' && <Sources data={activeData} result={active.result} />}
                </div>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
