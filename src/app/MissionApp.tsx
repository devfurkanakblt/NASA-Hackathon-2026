import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { motion, useAnimate, useReducedMotion } from 'motion/react'
import type { LoadedData, SiteData, SiteEntry } from '../data/contract.ts'
import { loadCells, loadHeader, loadYear } from '../data/extended.ts'
import { loadAllData, loadSiteVisuals } from '../data/load.ts'
import { MissionScene3D } from '../scene3d/index.ts'
import { SceneMissionControls } from '../scene3d/SceneMissionControls.tsx'
import { SceneMissionSummary } from '../scene3d/SceneMissionSummary.tsx'
import type { BodyState, PanelState } from '../scene3d/index.ts'
import type { TerrainGrid } from '../scene3d/types.ts'
import { earthOrientationAt, earthOrientationCoverageWarning, earthSunDirectionAt } from '../scene3d/appearance.ts'
import { DEFAULT_SETTINGS, missionStartRange, validateSettings } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { dailyVisibility } from '../sim/events.ts'
import { earthWobble } from './libration.ts'
import { sampleUtc } from '../sim/evaluate.ts'
import { countdown } from './countdown.ts'
import { csvFileName, downloadText, scenarioCsv } from './download.ts'
import { LineChart } from './charts/LineChart.tsx'
import { SkyVisibilityChart } from './charts/SkyVisibilityChart.tsx'
import { SeasonChart } from './charts/SeasonChart.tsx'
import { SiteMap } from './charts/SiteMap.tsx'
import { RimlightMark } from './Brand.tsx'
import { Comparison } from './Comparison.tsx'
import { Landing } from './Landing.tsx'
import { mapPointWhere, placeTitle, scenarioTitle } from './placeName.ts'
import { errorMessage, fmtUtc } from './format.ts'
import { cellId, isKnownSiteId, needsYear, parseCellId, resolveSiteData, sitesNeeded } from './extendedSites.ts'
import { computeFreePoint, placeForCoordinate } from './freePointLoader.ts'
import { parseFreePointId } from '../sim/freePoint.ts'
import { CoordinateForm } from './CoordinateForm.tsx'
import type { ExtendedState } from './extendedSites.ts'
import { defaultScenarios, elevationStats, evaluateAll, isEvaluated, newKey, scenarioLabel, scenarioColor, targetScenarioKey } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'
import { PlaceList } from './PlaceList.tsx'
import { ResearchView } from './ResearchView.tsx'
import { SearchPanel } from './SearchPanel.tsx'
import { PackageImport } from './PackageImport.tsx'
import { registerPackage } from '../data/packageService.ts'
import type { ScientificPackage } from '../data/scientificPackage.ts'
import { SettingsForm } from './SettingsForm.tsx'
import { MissionPlanner } from './MissionPlanner.tsx'
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

/**
 * The catalogue (science files of every place, ~14 MB) is fetched once per page: React StrictMode
 * runs effects twice in development and a remount would otherwise download it all again.
 */
let cataloguePending: ReturnType<typeof loadAllData> | null = null

const MoonGlobe = lazy(() => import('./MoonGlobe.tsx'))
const GlobalPointScene = lazy(() => import('../scene3d/GlobalPointScene.tsx').then(module => ({ default: module.GlobalPointScene })))

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

/** Playback speeds: mission seconds per real second. */
const SPEEDS: { value: number; label: string }[] = [
  { value: 6 * 3600, label: '6 h / s' },
  { value: 86400, label: '1 day / s' },
  { value: 3 * 86400, label: '3 days / s' },
  { value: 10 * 86400, label: '10 days / s' },
]



/**
 * The mission planner screen: scenarios (site + date) → mission hardware → comparison, with
 * the horizon panorama, timelines, power and battery charts and the 3D view on one time cursor.
 */
export function MissionApp() {
  const [loaded, setLoaded] = useState<LoadedData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<MissionSettings>(DEFAULT_SETTINGS)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const colors = useMemo(() => scenarios.map((_, i) => scenarioColor(i)), [scenarios])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(86400)
  const [view, setView] = useState<View>(viewFromLocation)
  const [simulationStage, setSimulationStage] = useState<'pick' | 'watch'>('pick')
  const [simulationStarted, setSimulationStarted] = useState(false)
  const [preparedPickKey, setPreparedPickKey] = useState('')
  const [readyTerrain, setReadyTerrain] = useState<TerrainGrid | null>(null)
  const [picked, setPicked] = useState<Scenario[]>([])
  const [pickMessage, setPickMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [flight, setFlight] = useState<(MoonFlight & { targetKey: string }) | null>(null)
  const [transitionId, setTransitionId] = useState(0)
  const transitionAction = useRef<(() => void) | null>(null)
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    if (!transitionId) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const swap = window.setTimeout(() => transitionAction.current?.(), reduced ? 80 : 480)
    const finish = window.setTimeout(() => setCovered(false), reduced ? 200 : 1200)
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
  const reducedMotion = useReducedMotion()
  // Switching the place shown keeps the charts mounted (their state stays); only a soft fade.
  const [panelScope, animatePanel] = useAnimate<HTMLDivElement>()
  const shownPlace = useRef(activeKey)
  useEffect(() => {
    if (shownPlace.current === activeKey) return
    shownPlace.current = activeKey
    if (reducedMotion || !panelScope.current) return
    void animatePanel(panelScope.current, { opacity: [0.35, 1] }, { duration: 0.42, ease: [0.23, 1, 0.32, 1] })
  }, [activeKey, animatePanel, panelScope, reducedMotion])
  const [tourOpen, setTourOpen] = useState(false)
  const diagnostics = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diagnostics') === '1'
  // Result of the last "Copy link", for the link it copied; a changed comparison clears it.
  const [copyResult, setCopyResult] = useState<{ hash: string; ok: boolean } | null>(null)
  // One-year series and map-point horizons, fetched per site after the first render.
  const [ext, setExt] = useState<ExtendedState>({ years: {}, cells: {} })

  // 3D terrain, imagery and Earth orientation are fetched per site, only for the places shown.
  const visualsPending = useRef<Record<string, Promise<void>>>({})
  const visualsReady = useRef(new Set<string>())
  const ensureVisuals = useCallback((ids: string[]) => {
    if (!loaded) return
    for (const id of new Set(ids)) {
      const data = loaded.bySite[id]
      if (!data || id in visualsPending.current) continue
      visualsPending.current[id] = loadSiteVisuals(data.site, data.ephemeris).then(v => {
        visualsReady.current.add(id)
        setLoaded(prev => prev && { ...prev, bySite: { ...prev.bySite, [id]: {
          ...prev.bySite[id], ...v, visualWarnings: [...(v.visualWarnings ?? []), ...(prev.bySite[id].visualWarnings ?? [])],
        } } })
      }, () => { visualsReady.current.add(id); setLoaded(prev => prev && { ...prev }) })
    }
  }, [loaded])
  const baseIdOf = (id: string) => parseCellId(id)?.siteId ?? id
  const shownBaseKey = [...new Set([...scenarios, ...picked].map(s => baseIdOf(s.siteId)))].sort().join(',')
  useEffect(() => { if (shownBaseKey) ensureVisuals(shownBaseKey.split(',')) }, [shownBaseKey, ensureVisuals])

  const pickKey = picked.map(place => `${place.key}:${place.siteId}`).join(',')
  useEffect(() => {
    if (!loaded || !picked.length || view !== 'simulation' || simulationStage !== 'pick') return
    // Wait for the display files; their arrival updates `loaded` and runs this again.
    const waiting = picked.map(place => baseIdOf(place.siteId)).filter(id => id in loaded.bySite && !visualsReady.current.has(id))
    if (waiting.length) { ensureVisuals(waiting); return }
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
  }, [loaded, picked, pickKey, view, simulationStage, ensureVisuals])

  useEffect(() => {
    let cancelled = false
    cataloguePending ??= loadAllData(undefined, { visuals: false })
    cataloguePending.catch(() => { cataloguePending = null })
    cataloguePending
      .then((data) => {
        if (cancelled) return
        const siteIds = data.sites.sites.map((s) => s.id)
        // A shared link (#s=...) opens the comparison it describes; otherwise the demo default.
        const shared = decodeShare(window.location.hash, (id) => isKnownSiteId(id, data.bySite))
        const initial = shared?.scenarios ?? defaultScenarios(siteIds)
        if (shared) setSettings(shared.settings)
        setLoaded(data)
        setScenarios(initial)
        // The Simulation page opens with the same places Results shows, not an empty globe.
        setPicked(initial)
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
    if (!loaded) return { years: [] as string[], cells: [] as string[], points: [] as string[] }
    const all = [...scenarios, ...picked]
    const need = sitesNeeded(all, loaded.sites.coverage.endUtc, settings.durationDays, loaded.bySite)
    const bases = scenarios.map((s) => parseCellId(s.siteId)?.siteId ?? s.siteId).filter((id) => id in loaded.bySite)
    // The Research tab compares catalogue places on the chosen dates: past the two-month period
    // that needs each place's one-year series, so fetch them only then (≈1.3 MB each). A
    // south-polar place only gets south-polar alternatives (research.ts), so only those load.
    const focus = scenarios.find((s) => s.key === activeKey) ?? scenarios[0]
    const focusBase = focus ? parseCellId(focus.siteId)?.siteId ?? focus.siteId : ''
    const contrast = loaded.bySite[focusBase]?.site.category === 'contrast'
    const research = tab === 'research' && focus && needsYear(focusBase, focus.startUtc, loaded.sites.coverage.endUtc, settings.durationDays)
      ? Object.keys(loaded.bySite).filter((id) => contrast || loaded.bySite[id].site.category !== 'contrast') : []
    return { years: [...new Set([...need.years, ...bases, ...research])], cells: need.cells, points: need.points }
  }, [loaded, scenarios, picked, settings.durationDays, tab, activeKey])
  const wantedKey = `${wanted.years.join(',')}|${wanted.cells.join(',')}|${wanted.points.join(',')}`
  useEffect(() => {
    const years = wanted.years.filter((id) => ext.years[id] === undefined)
    const cells = wanted.cells.filter((id) => ext.cells[id] === undefined)
    const points = wanted.points.filter((id) => ext.points?.[id] === undefined)
    if (years.length === 0 && cells.length === 0 && points.length === 0) return
    for (const id of points) {
      setExt((e) => ({ ...e, points: { ...e.points, [id]: 'loading' } }))
      computeFreePoint(id, loaded!.bySite).then(
        (d) => setExt((e) => ({ ...e, points: { ...e.points, [id]: d } })),
        (err) => {
          console.warn(`${id}:`, err)
          setExt((e) => ({ ...e, points: { ...e.points, [id]: 'error' } }))
        },
      )
    }
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
      loadHeader(id).then((h) => setExt((e) => ({ ...e, headers: { ...e.headers, [id]: h } })), () => mark('cells', id, 'error'))
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
    const point = ext.points?.[siteId]
    const full = point && point !== 'loading' && point !== 'error' ? point.ephemeris
      : loaded?.bySite[siteId]?.site.category === 'custom' ? loaded.bySite[siteId].ephemeris : undefined
    const year = ext.years[parseCellId(siteId)?.siteId ?? siteId]
    const series = full ?? (year && year !== 'loading' && year !== 'error' ? year : undefined)
    return series
      ? new Date(Date.parse(series.startUtc) + (series.count - 1) * series.stepS * 1000).toISOString()
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
  const activeColor = colors[active ? outcomes.indexOf(active) : 0]
  const activeData = active?.data ?? null
  const activeCell = activeData ? parseCellId(activeData.site.id) : null
  const activeFree = activeData ? parseFreePointId(activeData.site.id) : null
  // Map-point actions and the highlight stay on the chosen scenario, also while it loads.
  const chosenKey = targetScenarioKey(scenarios, activeKey)
  const chosenOutcome = outcomes.find((o) => o.scenario.key === chosenKey)
  const chosenScenario = scenarios.find(s => s.key === chosenKey)
  const chosenLoading = !!chosenOutcome?.loading
  const patchSceneScenario = (patch: Partial<Pick<Scenario, 'siteId' | 'startUtc'>>) => {
    setPlaying(false)
    setStep(0)
    setScenarios(list => list.map(s => s.key === chosenKey ? { ...s, ...patch } : s))
    setPicked(list => list.map(s => s.key === chosenKey ? { ...s, ...patch } : s))
  }
  const setActiveSite = (siteId: string) => {
    const previous = scenarios.find(s => s.key === chosenKey)
    if (!previous) return
    setMapUpdate({ key: previous.key, siteId, previous: placeTitle(previous.siteId, shownBySite) })
    setPlaying(false)
    setScenarios(list => list.map(s => s.key === previous.key ? { ...s, siteId } : s))
    setPicked(list => list.map(s => s.key === previous.key ? { ...s, siteId } : s))
  }
  const mapUpdateOutcome = mapUpdate && outcomes.find(o => o.scenario.key === mapUpdate.key && o.scenario.siteId === mapUpdate.siteId)

  const colorsOfEvaluated = evaluated.map((o) => colors[outcomes.indexOf(o)])

  const lastStep = evaluated.length ? evaluated[0].result.count - 1 : 0
  const playStepS = evaluated.length ? evaluated[0].result.stepS : 600
  const k = Math.min(step, lastStep)
  useEffect(() => {
    if (!playing || lastStep === 0) return
    // Time-based: the chosen speed holds on any display refresh rate.
    let last = performance.now()
    let carry = 0
    let frame = requestAnimationFrame(function tick(t) {
      carry += ((t - last) / 1000) * speed / playStepS
      last = t
      const n = Math.floor(carry)
      if (n > 0) {
        carry -= n
        setStep((s) => (s + n > lastStep ? 0 : s + n))
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, lastStep, speed, playStepS])

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

  const wobble = useMemo(() => (tracks ? earthWobble(tracks.earthPath.azDeg, tracks.earthPath.elDeg) : null), [tracks])

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
    () => evaluated.map((o) => ({ label: `${o.letter} · ${o.scenario.siteId}`, color: colors[outcomes.indexOf(o)], values: Array.from(o.result.socJ, (j) => (100 * j) / o.result.batteryCapacityJ) })),
    [evaluated, outcomes], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const socMarkers = evaluated
    .filter((o) => o.result.summary.firstReserveViolationS !== null)
    .map((o) => {
      const idx = Math.round((o.result.summary.firstReserveViolationS ?? 0) / o.result.stepS)
      return { index: idx, value: (100 * o.result.socJ[idx]) / o.result.batteryCapacityJ, color: colors[outcomes.indexOf(o)], label: `${o.letter}: below reserve on day ${Math.floor((idx * o.result.stepS) / 86400) + 1}` }
    })
  const powerMax = active ? Math.max(100, active.result.generationW.reduce((a, b) => Math.max(a, b), 0), active.result.loadW.reduce((a, b) => Math.max(a, b), 0)) : 100

  const tourSteps: TourStep[] = [
    {
      title: 'Find the light before you land.',
      body: "Near the Moon's south pole the Sun and Earth stay low on the horizon, so a hill or a crater rim can hide them. The light is on the rim. Rimlight checks two things for a landing spot: does the lander get enough sunlight for power, and can it see Earth to send data home?",
    },
    { target: 'places', title: '1. Pick places to compare', body: 'Choose locations on the Moon, then press Show in simulation. Use the arrows to visit them in selection order.', before: () => go('simulation') },
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
      body: 'These tabs show the reason behind the answer: the skyline the lander sees, the battery over time, a map of the area and how things change through the year. The skyline tab also explains why Earth is not fixed in the sky: the Moon wobbles slightly (libration), so Earth draws a small loop and, near the pole, rises and sets.',
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
      <select className="timebar__speed" aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
        {SPEEDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="timebar__time">
        Day {Math.floor(now.tS / 86400) + 1}, {fmtUtc(Date.parse(active.result.alignedStartUtc) + now.tS * 1000)}
      </span>
    </div>
  )
  // After the mission: the longest series loaded for this place (its one-year file for a catalogue site).
  const yearOfActive = activeData ? ext.years[activeData.site.id] : undefined
  const yearLoaded = yearOfActive && yearOfActive !== 'loading' && yearOfActive !== 'error' ? yearOfActive : null
  const afterSeries = active && activeData ? (yearLoaded && !parseCellId(activeData.site.id) ? yearLoaded : activeData.ephemeris) : null
  const after = (body: 'sun' | 'earth') =>
    active && activeData && afterSeries ? { ephemeris: afterSeries, horizon: activeData.horizon, body, missionEndUtc: sampleUtc(active.result, active.result.count - 1) } : undefined
  // Per-UTC-day visibility over the whole one-year series of the shown place.
  const dailyCsv = yearLoaded && activeData ? () => {
    const rows = dailyVisibility(yearLoaded, activeData.horizon)
    const lines = [`# ${activeData.site.name} (${activeData.site.id}); share of each UTC day with the body centre above the terrain horizon`, 'day,sun_pct,earth_pct,both_pct']
    for (const r of rows) lines.push(`${r.day},${r.sunPct},${r.earthPct},${r.bothPct}`)
    downloadText(lines.join('\n') + '\n', `${activeData.site.id.replace(/[^A-Za-z0-9._-]+/g, '-')}_daily-visibility.csv`)
  } : null
  const status = active && now && (
    <p className="status">
      <span className={now.sun.visible ? 'ok' : 'bad'}>
        <b>Sun</b> {now.sun.elDeg.toFixed(1)}° elevation · {countdown(active.result.sunWindows, now.sun.visible, now.tS, after('sun'))}
      </span>
      <span className={now.earth.visible ? 'ok' : 'bad'}>
        <b>Earth</b> {now.earth.elDeg.toFixed(1)}° elevation · {countdown(active.result.earthWindows, now.earth.visible, now.tS, after('earth'))}
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
          style={{ '--chip': colors[outcomes.indexOf(o)] } as CSSProperties}
          aria-pressed={o === active}
          onClick={() => setActiveKey(o.scenario.key)}
        >
          {o.letter} {scenarioTitle(o.scenario, scenarios, shownBySite)}
        </button>
      ))}
    </div>
  )
  const togglePlace = (site: SiteEntry) => updateLocations(picked.some(s => s.siteId === site.id)
    ? picked.filter(s => s.siteId !== site.id)
    : [...picked, { key: newKey(), siteId: site.id, startUtc: scenarios[0]?.startUtc ?? loaded.sites.coverage.startUtc }])
  const updateLocations = (next: Scenario[]) => {
    setPicked(next)
    setScenarios(next)
    setActiveKey(current => next.some(place => place.key === current) ? current : next[0]?.key ?? null)
  }
  /** A validated package: added to the site table (never over a catalogue site) and to the chosen places. */
  const addPackage = (pkg: ScientificPackage): { ok: boolean; text: string } => {
    let bySite: Record<string, SiteData>
    try {
      bySite = registerPackage(loaded.bySite, pkg)
    } catch (e) {
      return { ok: false, text: errorMessage(e) }
    }
    if (bySite !== loaded.bySite) setLoaded({ ...loaded, bySite })
    const id = pkg.data.site.id
    const range = missionStartRange(pkg.data.ephemeris, settings.durationDays)
    if (!range) return { ok: false, text: `${id} covers less than a ${settings.durationDays}-day mission.` }
    if (!picked.some((p) => p.siteId === id)) updateLocations([...picked, { key: newKey(), siteId: id, startUtc: range.firstStartUtc }])
    const m = pkg.manifest
    return { ok: true, text: `${pkg.data.site.name} added: data ${m.coverage.startUtc.slice(0, 10)} to ${m.coverage.endUtc.slice(0, 10)} (${m.horizonResolutionDeg}° horizon)${m.warnings.length ? `; ${m.warnings.length} coverage warning(s) shown with its results` : ''}.` }
  }

  /** A typed or clicked coordinate: the best available place for it, added to the picked places. */
  const addCoordinate = (lat: number, lon: number): { ok: boolean; text: string } => {
    const choice = placeForCoordinate(lat, lon, loaded.bySite)
    if ('error' in choice) return { ok: false, text: choice.error }
    if (picked.some(p => p.siteId === choice.siteId)) return { ok: false, text: 'This point is already in the comparison.' }
    updateLocations([...picked, { key: newKey(), siteId: choice.siteId, startUtc: scenarios[0]?.startUtc ?? loaded.sites.coverage.startUtc }])
    return { ok: true, text: choice.message }
  }

  const missionControls = <><SceneMissionControls
    sites={loaded.sites} scenarios={scenarios} chosenKey={chosenKey}
    durationDays={settings.durationDays} endUtc={maxStartFor(chosenScenario?.siteId ?? loaded.sites.sites[0].id)}
    onChoose={key => { setPlaying(false); setStep(0); setActiveKey(key) }} onPatch={patchSceneScenario}
    onDuration={durationDays => { setPlaying(false); setStep(0); setSettings(previous => ({ ...previous, durationDays })) }}
    onCoordinate={(lat, lon) => {
      const choice = placeForCoordinate(lat, lon, loaded.bySite)
      if ('error' in choice) return choice.error
      patchSceneScenario({ siteId: choice.siteId })
      return choice.message
    }}
    titleOf={s => scenarioTitle(s, scenarios, shownBySite)}
    onCopy={startUtc => { if (chosenScenario) { const copy = { ...chosenScenario, key: newKey(), startUtc }; const next = [...scenarios, copy]; setScenarios(next); setPicked(next); setActiveKey(copy.key); setPlaying(false); setStep(0) } }}
    onCompareAt={startUtc => { if (chosenScenario) { const copy = { ...chosenScenario, key: newKey(), startUtc }; const next = [...scenarios, copy]; setScenarios(next); setPicked(next); setActiveKey(copy.key); setPlaying(false); setStep(0) } }}
    onRemove={key => { const next = scenarios.filter(s => s.key !== key); if (!next.length) return; setScenarios(next); setPicked(next); setActiveKey(next[0].key); setPlaying(false); setStep(0) }} />
    <MissionPlanner key={JSON.stringify([settings, chosenScenario?.siteId, chosenScenario?.startUtc])}
      catalogue={loaded.bySite} selected={chosenOutcome?.data ?? undefined} settings={settings}
      startUtc={chosenScenario?.startUtc ?? loaded.sites.coverage.startUtc}
      onUse={(siteId, startUtc, durationDays) => {
        setSettings(previous => ({ ...previous, durationDays }))
        const next = { key: chosenScenario?.key ?? newKey(), siteId, startUtc }
        const updated = chosenScenario ? scenarios.map(s => s.key === next.key ? next : s) : [...scenarios, next]
        setScenarios(updated); setPicked(updated); setActiveKey(next.key); setPlaying(false); setStep(0)
      }} />
  </>

  // Choosing places is a single screen: the globe fills the viewport and the page does not scroll.
  const picking = view === 'simulation' && simulationStage === 'pick' && !flight
  return (
    <div className={picking ? 'app app--pick' : 'app'}>
      {header}
      {covered && <div key={transitionId} className="mission-blackout" aria-hidden="true" />}
      <Tour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} />
      {view === 'simulation' && (
        <div className="simulation-layout">
          <main className="app__main">
            <section className="card moon-picker" data-mode={flight ? 'flight' : simulationStage} aria-hidden={simulationStage !== 'pick' && !flight || undefined} inert={simulationStage !== 'pick' && !flight || undefined} data-tour="places">
              <div className="card__head"><div><h2>Choose places on the Moon</h2></div>
                <div className="moon-picker__selection" aria-live="polite">
                {picked.length === 0 && <p className="muted">No place chosen yet. Click a name on the globe.</p>}
                {picked.map((s, i) => <div key={s.key} className="moon-choice" style={{ '--place-color': colors[i] } as CSSProperties}>
                  <span className="moon-choice__letter">{scenarioLabel(i)}</span>
                  <span>{scenarioTitle(s, picked, shownBySite)}</span>
                  <button type="button" aria-label={`Remove ${placeTitle(s.siteId, loaded.bySite)}`} onClick={() => updateLocations(picked.filter(p => p.key !== s.key))}>&times;</button>
                </div>)}
              </div>
              <details className="moon-picker__coords moon-picker__places">
                <summary>Choose from the list ({loaded.sites.sites.length} places)</summary>
                <PlaceList sites={loaded.sites.sites} chosen={picked.map(p => p.siteId)} colors={picked.map((_, i) => scenarioColor(i))} onToggle={togglePlace} />
              </details>
              <details className="moon-picker__coords">
                <summary><span className="moon-picker__coords-icon" aria-hidden="true">⌖</span><span>Enter your own coordinates</span><span className="moon-picker__coords-hint">any point on the Moon</span></summary>
                <CoordinateForm action="Add point" onUse={addCoordinate} />
              </details>
              <PackageImport bySite={loaded.bySite} onPackage={addPackage} />
              {pickMessage && <p className={`small moon-picker__message ${pickMessage.ok ? 'muted' : 'bad'}`} role="status">{pickMessage.text}</p>}
              </div>
              <div className="moon-picker__globe"><Suspense fallback={<p role="status">Loading the Moon&hellip;</p>}>
                <MoonGlobe active={simulationStage === 'pick' || !!flight} flight={flight ?? undefined} onComplete={() => { if (flight) { setActiveKey(flight.targetKey); setFlight(null) } }} sites={loaded.sites.sites} selected={(flight ? scenarios : picked).flatMap((s, i) => {
                  const site = shownBySite[s.siteId]?.site ?? loaded.sites.sites.find(site => site.id === s.siteId)
                  return site ? [{ key: s.key, site, letter: scenarioLabel(i), color: colors[i] }] : []
                })} onSelect={togglePlace}
                  onPickPoint={(lat, lon) => setPickMessage(addCoordinate(lat, lon))} />
              </Suspense>
              {/* Actions float in the globe's lower-right corner once a place is chosen: no scrolling down. */}
              {picked.length > 0 && !flight && <div className="moon-picker__actions" role="group" aria-label="Selected places actions"><button type="button" className="primary" disabled={picked.length < 2} onClick={() => { setScenarios(picked); setActiveKey(picked[0].key); setPlaying(false); setStep(0); go('results') }}>Compare selected points</button><span className="muted small">{picked.length} locations</span>
                <button type="button" className="primary" disabled={!picked.length || covered || !selectionReady} onClick={() => darken(() => {
                  setScenarios(picked); setActiveKey(picked[0].key); setStep(0); setSimulationStarted(true); setSimulationStage('watch')
                })}>{picked.length > 0 && !selectionReady ? 'Preparing terrain…' : 'Show in simulation'} <span aria-hidden="true">↗</span></button></div>}
              </div>
              {flight && <p className="sim__flight-label" role="status">{flight.from.name} <span aria-hidden="true">&rarr;</span> {flight.to.name}</p>}
            </section>
            {simulationStarted && <section className="card sim" hidden={simulationStage === 'pick'} inert={simulationStage === 'pick' || undefined}>
              <div className="sim__route">
                <button type="button" disabled={!!flight || covered} onClick={() => darken(() => { setPicked(scenarios); setActiveKey(scenarios[0]?.key ?? null); setSimulationStage('pick') })}>&larr; Edit locations</button>
                <div className="sim__route-nav" aria-label="Selected location navigation">
                  <button type="button" aria-label="Previous location" disabled={activeIndex === 0 || !!flight || covered} onClick={() => travelTo(activeIndex - 1)}>&larr;</button>
                  <span role="status" style={{ color: colors[activeIndex] }}>{scenarioLabel(activeIndex)} &middot; {scenarios[activeIndex] ? scenarioTitle(scenarios[activeIndex], scenarios, shownBySite) : ''} <small>{activeIndex + 1} / {scenarios.length}</small></span>
                  <button type="button" aria-label="Next location" disabled={activeIndex >= scenarios.length - 1 || !!flight || covered} onClick={() => travelTo(activeIndex + 1)}>&rarr;</button>
                </div>
              </div>
              <div className="card__head">
                <div>
                  <h2>
                    Simulation
                    {active?.scenario.key === chosenKey && activeData && (
                      <>
                        {' '}
                        at <span style={{ color: activeColor }}>{active.letter}</span>, {placeTitle(activeData.site.id, shownBySite)}
                      </>
                    )}
                  </h2>
                </div>
              </div>
              {missionControls}
              {issues.length > 0 && <p className="bad">Check the mission duration here or the lander settings on Results to run the simulation.</p>}
              {active?.scenario.key === chosenKey && now && activeData && tracks ? (
                <>
                  <SceneMissionSummary result={active.result} settings={settings} />
                  {(activeCell && activeData.map) || activeFree || !activeData.terrain ? (
                    <div data-tour="scene">
                      <Suspense fallback={<p role="status">Loading point view…</p>}><GlobalPointScene
                        key={activeData.site.id} site={activeData.site} horizon={activeData.horizon}
                        nearTerrain={activeFree && activeData.terrain ? activeData.terrain : undefined}
                        sun={now.sun} earth={now.earth} sunPath={tracks.sunPath} earthPath={tracks.earthPath}
                        panel={panel} panelPowerW={active.result.generationW[now.kk]} diagnostics={diagnostics}
                        observerHeightM={activeData.site.observerHeightM} surfaceElevationM={activeData.site.surfaceElevationM}
                        earthOrientation={earthOrientationAt(activeData.earthOrientation, now.utc)}
                        earthSunDirection={earthSunDirectionAt(activeData.earthOrientation, now.utc)}
                        earthDisplayWarning={earthOrientationCoverageWarning(activeData.earthOrientation, now.utc)}
                        animateArrival={simulationStage === 'watch' && !flight}
                      /></Suspense>
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
                  <dl className="scene-mission__facts" aria-label="Selected mission facts">
                    <div><dt>Sun elevation · local horizontal</dt><dd>{now.sun.elDeg.toFixed(2)}°</dd>{elevationStats(active, 'sun') && <small>Highest {elevationStats(active, 'sun')!.maxDeg.toFixed(1)}°, average {elevationStats(active, 'sun')!.meanDeg.toFixed(1)}° this mission</small>}</div>
                    <div><dt>Earth elevation · local horizontal</dt><dd>{now.earth.elDeg.toFixed(2)}°</dd></div>
                    <div><dt>Battery now</dt><dd>{(100 * active.result.socJ[now.kk] / active.result.batteryCapacityJ).toFixed(1)}%</dd></div>
                  </dl>
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
            <section className="card" data-tour="result">
              <div className="card__head">
                <div>
                  <h2>
                    Results
                  </h2>
                </div>
                <div className="card__actions">
                  {active && activeData && issues.length === 0 && (
                    <button type="button" onClick={() => downloadText(scenarioCsv(activeData, active.result, settings), csvFileName(active.result, settings))}
                      title="Every 10-minute sample of the selected scenario, with its place, settings, data sources and model limits">
                      Download CSV ({active.letter})
                    </button>
                  )}
                  <button type="button" onClick={copyLink} data-tour="share" title="Copy a link that opens this comparison (places, dates and lander settings)">
                    {copied === 'done' ? 'Link copied' : 'Copy link'}
                  </button>
                </div>
              </div>
              {copied === 'failed' && <p className="small muted">This browser blocked copying. Copy the address bar instead; it already holds this comparison.</p>}
              {issues.length > 0 ? (
                <p className="bad">Some lander settings are out of range. Open Lander settings below to fix them.</p>
              ) : (
                scenarios.length ? <Comparison outcomes={outcomes} settings={settings} bySite={shownBySite} colors={colors} /> : (
                  <div className="results-empty"><p>Choose locations to see your results.</p><button type="button" className="primary" onClick={() => go('simulation')}>Choose locations</button></div>
                )
              )}
            </section>

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

            {issues.length === 0 && (
              <SearchPanel
                place={active && activeData ? { siteId: active.scenario.siteId, startUtc: active.result.alignedStartUtc, data: activeData } : null}
                settings={settings}
                bySite={loaded.bySite}
                titles={shownBySite}
                onAdd={(siteId, startUtc) => { const next = [...scenarios, { key: newKey(), siteId, startUtc }]; setScenarios(next); setPicked(next) }}
              />
            )}

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
                        {/* One underline that glides between tabs (Motion shared layout). */}
                        {tab === t.key && <motion.span layoutId="explore-tab-underline" className="tabs__underline" aria-hidden="true"
                          transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 }} />}
                      </button>
                    ))}
                  </div>
                  {placeChips}
                </div>

                <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="explore__panel" ref={panelScope}>
                  {/* A new tab fades and rises in; its content is rebuilt on tab change anyway. */}
                  <motion.div key={tab} className="explore__view"
                    initial={reducedMotion ? false : { opacity: 0, y: 10, filter: 'blur(3px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.38, ease: [0.23, 1, 0.32, 1] }}>
                  {tab === 'sky' && (
                    <>
                      {timebar}
                      <h3>
                        Sun &amp; Earth visibility
                      </h3>
                      <SkyVisibilityChart horizon={activeData.horizon} sun={tracks.sunPath} earth={tracks.earthPath} stepH={active.result.stepS / 3600} k={now.kk} />
                      {status}
                      {wobble && (
                        <p className="explain libration-note">
                          <strong>Why <span className="earth">Earth</span> moves in the sky.</strong> The Moon always turns the same face to us, so
                          Earth should hang still. It does not quite: the Moon&rsquo;s orbit is an ellipse and its axis is tilted, so it seems to
                          rock by a few degrees (this wobble is called <em>libration</em>). Earth therefore draws a small loop in the sky about once
                          every 27 days. During this mission it moved across {wobble.azSpanDeg.toFixed(1)}° of azimuth, between{' '}
                          {wobble.elMinDeg.toFixed(1)}° and {wobble.elMaxDeg.toFixed(1)}° of elevation.{' '}
                          {wobble.loop === 'crosses-horizon' && 'Here that loop crosses the level horizon, which is why Earth rises and sets at this place.'}
                          {wobble.loop === 'always-up' && 'Here the whole loop stayed above the level horizon, so Earth did not set during this mission.'}
                          {wobble.loop === 'never-up' && 'Here the whole loop stayed below the level horizon (far side), so Earth did not rise during this mission.'}
                        </p>
                      )}
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
                      resolveCatalogue={resolve}
                      psrs={loaded.psrs ?? []}
                      inScenarios={scenarios.map((s) => s.siteId)}
                      canAdd={true}
                      onCompare={(siteId) => {
                        const added = { key: newKey(), siteId, startUtc: active.scenario.startUtc }
                        setScenarios([...scenarios, added])
                        setPicked([...scenarios, added])
                      }}
                      year={activeCell ? null : ext.years[activeData.site.id] ?? null}
                      chosenDates={scenarios.filter((s) => s.siteId === active.scenario.siteId).map((s) => s.startUtc)}
                      onUseDate={(startUtc) => {
                        const added = { key: newKey(), siteId: active.scenario.siteId, startUtc }
                        setScenarios([...scenarios, added])
                        setPicked([...scenarios, added])
                      }}
                    />
                  )}

                  {tab === 'power' && (
                    <>
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
                      {activeData.season && (!activeCell || activeData.season.siteId === activeData.site.id) ? (
                        <>
                          <SeasonChart season={activeData.season} missionStartUtc={active.result.alignedStartUtc} />
                          {dailyCsv && <p><button type="button" onClick={dailyCsv}>Download daily Sun &amp; Earth visibility (CSV)</button></p>}
                        </>
                      ) : (
                        <p className="muted">No monthly summary for this exact point. Mission results above use this point’s own horizon; the catalogue centre’s annual summary is not substituted.</p>
                      )}
                    </>
                  )}

                  {tab === 'sources' && (
                    <>
                      <p className="export-row">
                        <button type="button" onClick={() => downloadText(scenarioCsv(activeData, active.result, settings), csvFileName(active.result, settings))}>
                          Download {active.letter} as CSV
                        </button>
                        <span className="small muted">Every 10-minute sample (UTC, Sun / Earth in view, panel W, demand W, battery Wh and %), with the place, settings, data sources and model limits at the top.</span>
                      </p>
                      <Sources data={activeData} result={active.result} />
                    </>
                  )}
                  </motion.div>
                </div>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
