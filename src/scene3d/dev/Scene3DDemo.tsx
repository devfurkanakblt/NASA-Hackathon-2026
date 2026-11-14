import { useEffect, useMemo, useState } from 'react'
import { bodyStatus, horizonElevationAt } from '../coords.ts'
import { MissionScene3D } from '../index.ts'
import type { BodyState, HorizonProfile, PanelMode, PanelState, TerrainGrid } from '../types.ts'
import './demo.css'

/** Shapes from docs/data-contract.md (v1) that the harness reads besides terrain and horizon. */
interface SiteEntry {
  id: string
  name: string
  observerHeightM: number
  coordSource: string
  demNear: string
  demFar: string
  label: string
  warnings: string[]
}
interface SitesDoc {
  coverage: { startUtc: string; endUtc: string; stepS: number }
  sites: SiteEntry[]
}
interface BodySeries {
  azDeg: number[]
  elDeg: number[]
  distanceM: number[]
}
interface EphemerisDoc {
  source: string
  startUtc: string
  stepS: number
  count: number
  sun: BodySeries
  earth: BodySeries
}
interface HorizonDoc extends HorizonProfile {
  warnings?: string[]
}
interface SiteData {
  siteId: string
  terrain: TerrainGrid
  horizon: HorizonDoc
  ephemeris: EphemerisDoc
}

const DATA_URL = `${import.meta.env.BASE_URL}data`
/** Default mission start in the plan. */
const DEFAULT_START_UTC = '2026-11-15T00:00:00Z'
/** Time steps advanced per animation frame while playing (one step = 10 minutes). */
const STEPS_PER_FRAME = 2

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${DATA_URL}/${path}`)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return (await response.json()) as T
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Sun or Earth at one time step. Visibility is the data contract's shared rule: centre above the terrain horizon. */
function bodyAt(series: BodySeries, i: number, horizon: HorizonProfile): BodyState {
  const azDeg = series.azDeg[i]
  const elDeg = series.elDeg[i]
  return { azDeg, elDeg, distanceM: series.distanceM[i], visible: elDeg > horizonElevationAt(horizon, azDeg) }
}

/**
 * Stand-alone harness for the 3D view, fed with the files in `public/data/`.
 * It stands in for the app shell until the real layout and simulation engine are wired in;
 * the visibility flags it passes are the contract's shared rule, as the engine will apply it.
 *
 *   ?fail=terrain   hand the scene a malformed grid to check the fallback
 */
export function Scene3DDemo() {
  const broken = useMemo(() => new URLSearchParams(window.location.search).get('fail') === 'terrain', [])

  const [sites, setSites] = useState<SitesDoc | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [dataBySite, setDataBySite] = useState<Record<string, SiteData> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('tracking')
  const [fixedAz, setFixedAz] = useState(90)

  // Everything is loaded up front: after this, no user action causes a network request.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const doc = await getJson<SitesDoc>('sites.json')
      const loaded = await Promise.all(
        doc.sites.map(async ({ id }) => {
          const [terrain, horizon, ephemeris] = await Promise.all([
            getJson<TerrainGrid>(`${id}/terrain.json`),
            getJson<HorizonDoc>(`${id}/horizon.json`),
            getJson<EphemerisDoc>(`${id}/ephemeris.json`),
          ])
          return [id, { siteId: id, terrain, horizon, ephemeris }] as const
        }),
      )
      if (cancelled) return
      const { startUtc, stepS } = doc.coverage
      setSites(doc)
      setDataBySite(Object.fromEntries(loaded))
      setSiteId(doc.sites[0]?.id ?? null)
      setStep(Math.max(0, Math.round((Date.parse(DEFAULT_START_UTC) - Date.parse(startUtc)) / (stepS * 1000))))
    }
    load().catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const current = (siteId && dataBySite?.[siteId]) || null
  const lastStep = current ? current.ephemeris.count - 1 : 0
  useEffect(() => {
    if (!playing || lastStep === 0) return
    let frame = requestAnimationFrame(function tick() {
      setStep((s) => (s + STEPS_PER_FRAME > lastStep ? 0 : s + STEPS_PER_FRAME))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, lastStep])

  const site = sites?.sites.find((s) => s.id === siteId) ?? null
  const i = Math.min(step, lastStep)
  const sun = current ? bodyAt(current.ephemeris.sun, i, current.horizon) : null
  const earth = current ? bodyAt(current.ephemeris.earth, i, current.horizon) : null
  const utc = current
    ? `${new Date(Date.parse(current.ephemeris.startUtc) + i * current.ephemeris.stepS * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : ''
  const panel = useMemo<PanelState>(() => ({ mode: panelMode, areaM2: 2, fixedNormalAzDeg: fixedAz, fixedNormalElDeg: 0 }), [panelMode, fixedAz])
  const sceneTerrain = useMemo<TerrainGrid | null>(
    () => (current ? (broken ? { ...current.terrain, zM: [0, 1, 2] } : current.terrain) : null),
    [broken, current],
  )
  const warnings = [...(site?.warnings ?? []), ...(current?.horizon.warnings ?? [])]

  return (
    <div className="demo">
      <header className="demo__bar">
        <label>
          Site{' '}
          <select value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} disabled={!sites}>
            {sites?.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPlaying((p) => !p)} disabled={!current}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          className="demo__slider"
          type="range"
          min={0}
          max={lastStep}
          step={1}
          value={i}
          aria-label="Time (UTC)"
          disabled={!current}
          onChange={(e) => setStep(Number(e.target.value))}
        />
        <span className="demo__time">{utc}</span>
        <label>
          Panel{' '}
          <select value={panelMode} onChange={(e) => setPanelMode(e.target.value as PanelMode)}>
            <option value="tracking">ideal tracking</option>
            <option value="fixed">fixed</option>
          </select>
        </label>
        {panelMode === 'fixed' && (
          <label>
            Normal az{' '}
            <input type="number" min={0} max={359} step={5} value={fixedAz} onChange={(e) => setFixedAz(Number(e.target.value))} />°
          </label>
        )}
        {sun && earth && (
          <>
            <span className="demo__readout" data-testid="sun-readout">
              Sun az {sun.azDeg.toFixed(1)}° el {sun.elDeg.toFixed(2)}° · {bodyStatus(sun)}
            </span>
            <span className="demo__readout" data-testid="earth-readout">
              Earth az {earth.azDeg.toFixed(1)}° el {earth.elDeg.toFixed(2)}° · {bodyStatus(earth)}
            </span>
          </>
        )}
      </header>

      {site && current && (
        <div className="demo__source" data-testid="provenance">
          <span>
            Terrain and horizon: {site.demNear} + {site.demFar} · Sun and Earth: {current.ephemeris.source} · Coordinates: {site.coordSource}
          </span>
          <span>{site.label}</span>
          {warnings.map((w) => (
            <span key={w} className="demo__warning">
              Note: {w}
            </span>
          ))}
        </div>
      )}

      <main className="demo__scene">
        {error ? (
          <p className="demo__message" role="alert">
            Could not load the site data from <code>public/data/</code> ({error}). Pull <code>main</code> or run the preprocessing.
          </p>
        ) : current && sceneTerrain && sun && earth && site ? (
          <MissionScene3D terrain={sceneTerrain} horizon={current.horizon} sun={sun} earth={earth} panel={panel} observerHeightM={site.observerHeightM} />
        ) : (
          <p className="demo__message">Loading site data…</p>
        )}
      </main>
    </div>
  )
}
