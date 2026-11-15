import { useEffect, useMemo, useState } from 'react'
import type { LoadedData } from '../../data/contract.ts'
import { loadAllData } from '../../data/load.ts'
import { J_PER_WH } from '../../sim/energy.ts'
import { DEFAULT_SETTINGS, MAX_DURATION_DAYS, MIN_DURATION_DAYS, evaluateScenario } from '../../sim/evaluate.ts'
import type { MissionSettings, ScenarioResult } from '../../sim/evaluate.ts'
import { nextTransition } from '../../sim/visibility.ts'
import type { VisibilityWindow } from '../../sim/visibility.ts'
import { bodyStatus, earthAngularDiameterDeg, sunAngularDiameterDeg } from '../coords.ts'
import { MissionScene3D } from '../index.ts'
import { earthOrientationAt, earthOrientationCoverageWarning, earthSunDirectionAt } from '../appearance.ts'
import type { BodyPath, BodyState, PanelState, TerrainGrid } from '../types.ts'
import './demo.css'

/** Default mission start in the plan. */
const DEFAULT_START_UTC = '2026-11-15T00:00:00Z'
/** Time steps advanced per animation frame while playing (one step = 10 minutes). */
const STEPS_PER_FRAME = 2
const HOUR_MS = 3600 * 1000

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const utcLabel = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

/** "Sunset in 2 d 3 h" — the time left before the body's state changes, if it does within the mission. */
function countdown(name: string, windows: VisibilityWindow[], visibleNow: boolean, tS: number): string {
  const next = nextTransition(windows, tS)
  if (!next) return visibleNow ? `${name} stays up for the rest of the mission` : `${name} stays hidden for the rest of the mission`
  return next.kind === 'set' ? `${name}set in ${duration(next.atS - tS)}` : `${name}rise in ${duration(next.atS - tS)}`
}

/**
 * Stand-alone harness: the 3D view plus the simulation engine, run on the files in
 * `public/data/`. Open with `?demo=3d`; the main screen remains Person B's responsibility.
 *
 *   ?fail=terrain   hand the scene a malformed grid to check the fallback
 */
export function Scene3DDemo() {
  const broken = useMemo(() => new URLSearchParams(window.location.search).get('fail') === 'terrain', [])
  const diagnostics = useMemo(() => new URLSearchParams(window.location.search).get('diagnostics') === '1', [])

  const [loaded, setLoaded] = useState<LoadedData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [startUtc, setStartUtc] = useState(DEFAULT_START_UTC)
  const [settings, setSettings] = useState<MissionSettings>(DEFAULT_SETTINGS)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadAllData()
      .then((data) => {
        if (cancelled) return
        setLoaded(data)
        setSiteId(data.sites.sites[0]?.id ?? null)
      })
      .catch((e) => !cancelled && setLoadError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const data = (siteId && loaded?.bySite[siteId]) || null

  // The whole mission is evaluated at once whenever the site, start or settings change.
  const evaluation = useMemo<{ result: ScenarioResult | null; error: string | null }>(() => {
    if (!data) return { result: null, error: null }
    try {
      return { result: evaluateScenario(data, startUtc, settings), error: null }
    } catch (e) {
      return { result: null, error: message(e) }
    }
  }, [data, startUtc, settings])
  const { result } = evaluation

  const lastStep = result ? result.count - 1 : 0
  useEffect(() => {
    if (!playing || lastStep === 0) return
    let frame = requestAnimationFrame(function tick() {
      setStep((s) => (s + STEPS_PER_FRAME > lastStep ? 0 : s + STEPS_PER_FRAME))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, lastStep])

  const k = Math.min(step, lastStep)
  const startMs = Date.parse(result?.alignedStartUtc ?? startUtc)

  // Tracks of the Sun and Earth over the mission, flagged by the engine.
  const paths = useMemo<{ sun: BodyPath; earth: BodyPath } | null>(() => {
    if (!data || !result) return null
    const slice = (values: number[]) => values.slice(result.startIndex, result.startIndex + result.count)
    return {
      sun: { azDeg: slice(data.ephemeris.sun.azDeg), elDeg: slice(data.ephemeris.sun.elDeg), visible: result.sunVisible },
      earth: { azDeg: slice(data.ephemeris.earth.azDeg), elDeg: slice(data.ephemeris.earth.elDeg), visible: result.earthVisible },
    }
  }, [data, result])

  const now = useMemo(() => {
    if (!data || !result) return null
    const i = result.startIndex + k
    const { sun, earth } = data.ephemeris
    const sunState: BodyState = { azDeg: sun.azDeg[i], elDeg: sun.elDeg[i], distanceM: sun.distanceM[i], visible: result.sunVisible[k] }
    const earthState: BodyState = { azDeg: earth.azDeg[i], elDeg: earth.elDeg[i], distanceM: earth.distanceM[i], visible: result.earthVisible[k] }
    return { sun: sunState, earth: earthState, tS: k * result.stepS }
  }, [data, result, k])

  const panel = useMemo<PanelState>(
    () => ({ mode: settings.panelMode, areaM2: settings.panelAreaM2, fixedNormalAzDeg: settings.fixedNormalAzDeg, fixedNormalElDeg: settings.fixedNormalElDeg }),
    [settings.panelMode, settings.panelAreaM2, settings.fixedNormalAzDeg, settings.fixedNormalElDeg],
  )
  const sceneTerrain = useMemo<TerrainGrid | undefined>(() => (data?.terrain ? (broken ? { ...data.terrain, zM: [0, 1, 2] } : data.terrain) : undefined), [broken, data])

  const coverage = loaded?.sites.coverage
  const shiftStart = (hours: number) => {
    setStartUtc(new Date(startMs + hours * HOUR_MS).toISOString().replace('.000Z', 'Z'))
    setStep(0)
  }
  const patchSettings = (patch: Partial<MissionSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const updateStartDate = (value: string) => {
    if (!value) return
    setStartUtc(`${value}T00:00:00Z`)
    setStep(0)
  }
  const warnings = [...(data?.site.warnings ?? []), ...(data?.horizon.warnings ?? []), ...(data?.visualWarnings ?? [])]
  const summary = result?.summary

  return (
    <div className="demo">
      <header className="demo__bar">
        <label>
          Site{' '}
          <select value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} disabled={!loaded}>
            {loaded?.sites.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mission start (UTC){' '}
          <input
            type="date"
            value={startUtc.slice(0, 10)}
            min={coverage?.startUtc.slice(0, 10)}
            max={coverage?.endUtc.slice(0, 10)}
            onInput={e => updateStartDate(e.currentTarget.value)}
            onChange={e => updateStartDate(e.currentTarget.value)}
          />
        </label>
        <span className="demo__group">
          <button type="button" onClick={() => shiftStart(24)}>
            +24 h
          </button>
          <button type="button" onClick={() => shiftStart(72)}>
            +72 h
          </button>
        </span>
        <label>
          Days{' '}
          <input
            type="number"
            min={1}
            max={MAX_DURATION_DAYS}
            value={settings.durationDays}
            onChange={(e) => {
              patchSettings({ durationDays: Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Math.round(Number(e.target.value) || 1))) })
              setStep(0)
            }}
          />
        </label>
        <label>
          Panel{' '}
          <select value={settings.panelMode} onChange={(e) => patchSettings({ panelMode: e.target.value as MissionSettings['panelMode'] })}>
            <option value="tracking">ideal tracking</option>
            <option value="fixed">fixed</option>
          </select>
        </label>
        {diagnostics && <button type="button" onClick={() => {
          const canvas = document.querySelector<HTMLCanvasElement>('.scene3d canvas')
          const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
          gl?.getExtension('WEBGL_lose_context')?.loseContext()
        }}>Test GPU context loss</button>}
        {settings.panelMode === 'fixed' && (
          <label>
            Normal az{' '}
            <input type="number" min={0} max={359} step={5} value={settings.fixedNormalAzDeg} onChange={(e) => patchSettings({ fixedNormalAzDeg: Number(e.target.value) })} />°
          </label>
        )}
      </header>

      <div className="demo__bar demo__bar--time">
        <button type="button" onClick={() => setPlaying((p) => !p)} disabled={!result}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input className="demo__slider" type="range" min={0} max={lastStep} step={1} value={k} aria-label="Time in mission" disabled={!result} onChange={(e) => setStep(Number(e.target.value))} />
        <span className="demo__time">{result && now ? `${utcLabel(startMs + now.tS * 1000)} · T+ ${duration(now.tS)}` : ''}</span>
      </div>

      {result && now && summary && (
        <div className="demo__summary" data-testid="summary">
          <span data-testid="sun-readout">
            Sun az {now.sun.azDeg.toFixed(1)}° el {now.sun.elDeg.toFixed(2)}° · {sunAngularDiameterDeg(now.sun.distanceM).toFixed(2)}° wide ·{' '}
            {((now.sun.distanceM ?? 0) / 1e9).toFixed(1)} million km · {bodyStatus(now.sun)}
          </span>
          <span data-testid="earth-readout">
            Earth az {now.earth.azDeg.toFixed(1)}° el {now.earth.elDeg.toFixed(2)}° · {earthAngularDiameterDeg(now.earth.distanceM).toFixed(2)}° wide ·{' '}
            {Math.round((now.earth.distanceM ?? 0) / 1000).toLocaleString('en-US')} km · {bodyStatus(now.earth)}
          </span>
          <span data-testid="countdowns">
            {countdown('Sun', result.sunWindows, now.sun.visible, now.tS)} · {countdown('Earth', result.earthWindows, now.earth.visible, now.tS)}
          </span>
          <span data-testid="power-readout">
            Panel {Math.round(result.generationW[k])} W · load {Math.round(result.loadW[k])} W · battery {Math.round((100 * result.socJ[k]) / result.batteryCapacityJ)}% (
            {(result.socJ[k] / J_PER_WH / 1000).toFixed(2)} kWh)
          </span>
          <span className={summary.keepsBatteryReserve ? 'demo__ok' : 'demo__bad'} data-testid="battery-verdict">
            {summary.keepsBatteryReserve
              ? `Battery stays above its ${Math.round(settings.reserveFraction * 100)}% reserve (lowest ${Math.round(summary.minSocFraction * 100)}%)`
              : `Battery drops below its ${Math.round(settings.reserveFraction * 100)}% reserve at T+ ${duration(summary.firstReserveViolationS ?? 0)}; unmet demand ${(summary.unmetEnergyJ / J_PER_WH / 1000).toFixed(1)} kWh`}
          </span>
          <span className={summary.earthOutageWithinLimit ? 'demo__ok' : 'demo__bad'} data-testid="earth-verdict">
            Longest Earth outage {duration(summary.longestEarthOutageS)} — {summary.earthOutageWithinLimit ? 'within' : 'over'} the {settings.maxEarthOutageH} h limit
          </span>
          <span>
            Over the mission: Sun {Math.round(summary.sunVisibleFraction * 100)}%, Earth {Math.round(summary.earthVisibleFraction * 100)}%, both{' '}
            {Math.round(summary.bothVisibleFraction * 100)}% of the time · generated {(summary.energyGeneratedJ / J_PER_WH / 1000).toFixed(1)} kWh, demand{' '}
            {(summary.energyDemandJ / J_PER_WH / 1000).toFixed(1)} kWh
          </span>
        </div>
      )}

      {data && (
        <div className="demo__source" data-testid="provenance">
          <span>
            Terrain and horizon: {data.site.demNear} + {data.site.demFar} · Sun and Earth: {data.ephemeris.source} · Coordinates: {data.site.coordSource}
          </span>
          <span>{data.site.label} · Hardware values are example assumptions</span>
          {warnings.map((w) => (
            <span key={w} className="demo__warning">
              Note: {w}
            </span>
          ))}
        </div>
      )}

      <main className="demo__scene">
        {loadError ? (
          <p className="demo__message" role="alert">
            Could not load the site data from <code>public/data/</code> ({loadError}). Pull <code>main</code> or run the preprocessing.
          </p>
        ) : evaluation.error ? (
          <p className="demo__message" role="alert">
            {evaluation.error}
          </p>
        ) : data && result && now && paths ? (
          <MissionScene3D
            terrain={sceneTerrain}
            farTerrain={data.terrainFar}
            horizon={data.horizon}
            sun={now.sun}
            earth={now.earth}
            sunPath={paths.sun}
            earthPath={paths.earth}
            earthOrientation={earthOrientationAt(data.earthOrientation, new Date(Date.parse(result.alignedStartUtc) + now.tS * 1000).toISOString())}
            earthSunDirection={earthSunDirectionAt(data.earthOrientation, new Date(Date.parse(result.alignedStartUtc) + now.tS * 1000).toISOString())}
            earthDisplayWarning={earthOrientationCoverageWarning(data.earthOrientation, new Date(Date.parse(result.alignedStartUtc) + now.tS * 1000).toISOString())}
            panelPowerW={result.generationW[k]}
            diagnostics={diagnostics}
            panel={panel}
            observerHeightM={data.site.observerHeightM}
            surfaceElevationM={data.site.surfaceElevationM}
          />
        ) : (
          <p className="demo__message">Loading site data…</p>
        )}
      </main>
    </div>
  )
}
