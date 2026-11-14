import { Canvas } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Object3D } from 'three'
import {
  DEFAULT_PANEL,
  OBSERVER_HEIGHT_M,
  azElToUnitVector,
  bodyStatus,
  earthAngularDiameterDeg,
  horizonDistanceAt,
  horizonElevationAt,
  panelIsLit,
  panelNormal,
  sunAngularDiameterDeg,
} from './coords.ts'
import { EARTH_COLOR, GEOMETRIC_HORIZON_COLOR, STATUS_COLOR, STATUS_TEXT, SUN_COLOR, TERRAIN_HORIZON_COLOR } from './palette.ts'
import { CameraRig } from './parts/CameraRig.tsx'
import { CompassPoints, HorizonCurtain, HorizonLines } from './parts/HorizonOverlay.tsx'
import { LabelProjector } from './parts/Labels.tsx'
import type { LabelBinding } from './parts/Labels.tsx'
import { Lander } from './parts/Lander.tsx'
import { LanderViewBody, OverviewMarker } from './parts/SkyBodies.tsx'
import { Terrain } from './parts/Terrain.tsx'
import './scene3d.css'
import { buildTerrainMeshData } from './terrainGeometry.ts'
import type { BodyState, BodyStatus, CameraMode, HorizonProfile, LookTarget, PanelState, TerrainGrid } from './types.ts'

export interface MissionScene3DProps {
  /** Local elevation grid of the selected site (`terrain.json`). */
  terrain: TerrainGrid
  /** Terrain horizon of the selected site (`horizon.json`). */
  horizon: HorizonProfile
  /** Sun / Earth at the current time step; `visible` comes from the simulation engine. */
  sun: BodyState
  earth: BodyState
  panel?: PanelState
  /** Elevation of the geometric (flat) horizon, drawn dashed. Default 0°. */
  geometricHorizonDeg?: number
  /** Observer height above ground. Default 2 m, as everywhere in the project. */
  observerHeightM?: number
  defaultCameraMode?: CameraMode
  defaultShowTerrainEffect?: boolean
}

const fmt = (deg: number) => `${deg.toFixed(2)}°`
const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

/** One sentence that says why a body is, or is not, in view. */
function explain(name: string, body: BodyState, status: BodyStatus, horizon: HorizonProfile, geometricHorizonDeg: number): string {
  const terrainEl = horizonElevationAt(horizon, body.azDeg)
  const az = `${body.azDeg.toFixed(1)}°`
  const distanceM = horizonDistanceAt(horizon, body.azDeg)
  const ridge = distanceM === undefined ? '' : `, formed by terrain ${fmtKm(distanceM)} away`
  if (status === 'terrain-blocked') {
    return `${name} is ${fmt(body.elDeg - geometricHorizonDeg)} above the geometric horizon, but the terrain horizon at azimuth ${az} reaches ${fmt(terrainEl)}${ridge} — hidden behind terrain.`
  }
  if (status === 'visible') {
    return `${name} is in view at elevation ${fmt(body.elDeg)}; the terrain horizon at azimuth ${az} is ${fmt(terrainEl)}${ridge}.`
  }
  return `${name} is below the geometric horizon (elevation ${fmt(body.elDeg)}).`
}

function BodyTag({ elementRef, name, color, status }: { elementRef: RefObject<HTMLDivElement | null>; name: string; color: string; status: BodyStatus }) {
  return (
    <div ref={elementRef} className="scene3d__label" style={{ color: STATUS_COLOR[status] ?? color }}>
      <span className="scene3d__label-name" style={{ color }}>
        {name}
      </span>
      {' · '}
      {STATUS_TEXT[status]}
    </div>
  )
}

/** One scene anchor + one DOM element per label; see parts/Labels.tsx. */
function useLabel() {
  const anchor = useRef<Object3D | null>(null)
  const element = useRef<HTMLDivElement | null>(null)
  return useMemo(() => ({ anchor, element }), [])
}

export default function SceneCanvas({
  terrain,
  horizon,
  sun,
  earth,
  panel = DEFAULT_PANEL,
  geometricHorizonDeg = 0,
  observerHeightM = OBSERVER_HEIGHT_M,
  defaultCameraMode = 'overview',
  defaultShowTerrainEffect = false,
}: MissionScene3DProps) {
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaultCameraMode)
  const [showTerrainEffect, setShowTerrainEffect] = useState(defaultShowTerrainEffect)
  const [lookTarget, setLookTarget] = useState<LookTarget>('sun')
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)

  const meshData = useMemo(() => buildTerrainMeshData(terrain, observerHeightM), [terrain, observerHeightM])
  const half = meshData.halfExtentM
  const overviewRadius = half * 0.9
  const curtainRadius = half * 2.2
  const bodyRadius = half * 2.4

  const sunStatus = bodyStatus(sun, geometricHorizonDeg)
  const earthStatus = bodyStatus(earth, geometricHorizonDeg)
  const sunDirection = useMemo(() => azElToUnitVector(sun.azDeg, sun.elDeg), [sun.azDeg, sun.elDeg])
  const normal = useMemo(() => panelNormal(panel, { azDeg: sun.azDeg, elDeg: sun.elDeg }), [panel, sun.azDeg, sun.elDeg])
  const lit = panelIsLit(panel, sun)
  const freeLook = useCallback(() => setLookTarget('free'), [])

  const sunLabel = useLabel()
  const earthLabel = useLabel()
  const northLabel = useLabel()
  const eastLabel = useLabel()
  const southLabel = useLabel()
  const westLabel = useLabel()
  const labels = useMemo<LabelBinding[]>(
    () => [sunLabel, earthLabel, northLabel, eastLabel, southLabel, westLabel],
    [sunLabel, earthLabel, northLabel, eastLabel, southLabel, westLabel],
  )
  const compassAnchors = useMemo(
    () => ({ north: northLabel.anchor, east: eastLabel.anchor, south: southLabel.anchor, west: westLabel.anchor }),
    [northLabel, eastLabel, southLabel, westLabel],
  )

  return (
    <div className="scene3d">
      <Canvas
        key={canvasKey}
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, near: 5, far: half * 40, position: [half, half * 1.15, half * 1.7] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            setContextLost(true)
          })
        }}
      >
        <color attach="background" args={['#000000']} />
        <hemisphereLight args={['#c3cbdb', '#2a2d35', 1.5]} />
        {/* Shading follows the engine's answer: no sunlight when the Sun is not visible from the site. */}
        <directionalLight
          position={[sunDirection[0] * 1000, sunDirection[1] * 1000, sunDirection[2] * 1000]}
          intensity={sun.visible ? 4 : 0}
          color="#fff4e0"
        />

        <Terrain data={meshData} />
        {cameraMode === 'overview' && <Lander panelNormal={normal} panelLit={lit} panelAreaM2={panel.areaM2} northLabelAnchor={northLabel.anchor} />}

        <group position={[0, observerHeightM, 0]}>
          {cameraMode === 'overview' ? (
            <>
              {showTerrainEffect && <HorizonLines profile={horizon} radius={overviewRadius} geometricHorizonDeg={geometricHorizonDeg} />}
              <OverviewMarker color={SUN_COLOR} body={sun} status={sunStatus} labelAnchor={sunLabel.anchor} radius={overviewRadius} markerRadius={half * 0.03} />
              <OverviewMarker color={EARTH_COLOR} body={earth} status={earthStatus} labelAnchor={earthLabel.anchor} radius={overviewRadius} markerRadius={half * 0.03} />
            </>
          ) : (
            <>
              <HorizonCurtain profile={horizon} radius={curtainRadius} xray={showTerrainEffect} />
              {showTerrainEffect && <HorizonLines profile={horizon} radius={curtainRadius * 0.999} geometricHorizonDeg={geometricHorizonDeg} />}
              <LanderViewBody color={SUN_COLOR} body={sun} status={sunStatus} labelAnchor={sunLabel.anchor} radius={bodyRadius} angularDiameterDeg={sunAngularDiameterDeg(sun.distanceM)} xray={showTerrainEffect} />
              <LanderViewBody color={EARTH_COLOR} body={earth} status={earthStatus} labelAnchor={earthLabel.anchor} radius={bodyRadius} angularDiameterDeg={earthAngularDiameterDeg(earth.distanceM)} xray={showTerrainEffect} />
              <CompassPoints radius={curtainRadius} anchors={compassAnchors} />
            </>
          )}
        </group>

        <CameraRig
          mode={cameraMode}
          halfExtentM={half}
          eyeHeightM={observerHeightM}
          lookTarget={lookTarget}
          sun={sun}
          earth={earth}
          onUserLook={freeLook}
        />
        <LabelProjector bindings={labels} />
      </Canvas>

      <div className="scene3d__labels">
        <BodyTag elementRef={sunLabel.element} name="Sun" color={SUN_COLOR} status={sunStatus} />
        <BodyTag elementRef={earthLabel.element} name="Earth" color={EARTH_COLOR} status={earthStatus} />
        <div ref={northLabel.element} className="scene3d__label scene3d__label--compass scene3d__label--north">
          N
        </div>
        <div ref={eastLabel.element} className="scene3d__label scene3d__label--compass">
          E
        </div>
        <div ref={southLabel.element} className="scene3d__label scene3d__label--compass">
          S
        </div>
        <div ref={westLabel.element} className="scene3d__label scene3d__label--compass">
          W
        </div>
      </div>

      <div className="scene3d__toolbar">
        <div className="scene3d__segmented" role="group" aria-label="Camera">
          <button type="button" aria-pressed={cameraMode === 'overview'} onClick={() => setCameraMode('overview')}>
            Terrain overview
          </button>
          <button type="button" aria-pressed={cameraMode === 'lander'} onClick={() => setCameraMode('lander')}>
            View from lander
          </button>
        </div>
        {cameraMode === 'lander' && (
          <div className="scene3d__segmented" role="group" aria-label="Look at">
            <button type="button" aria-pressed={lookTarget === 'sun'} onClick={() => setLookTarget('sun')}>
              Look at Sun
            </button>
            <button type="button" aria-pressed={lookTarget === 'earth'} onClick={() => setLookTarget('earth')}>
              Look at Earth
            </button>
          </div>
        )}
        <label className="scene3d__check">
          <input type="checkbox" checked={showTerrainEffect} onChange={(e) => setShowTerrainEffect(e.target.checked)} />
          Show terrain effect
        </label>
      </div>

      {showTerrainEffect && (
        <div className="scene3d__explain" role="status">
          <div className="scene3d__legend">
            <span>
              <i style={{ background: TERRAIN_HORIZON_COLOR }} /> Terrain horizon (pre-computed profile)
            </span>
            <span>
              <i className="scene3d__dash" style={{ color: GEOMETRIC_HORIZON_COLOR }} /> Geometric horizon
            </span>
          </div>
          <p>{explain('The Sun', sun, sunStatus, horizon, geometricHorizonDeg)}</p>
          <p>{explain('Earth', earth, earthStatus, horizon, geometricHorizonDeg)}</p>
        </div>
      )}

      <p className="scene3d__note">
        {cameraMode === 'overview' ? 'Lander and markers not to scale. ' : 'Sun and Earth discs at true angular size. Drag to look, scroll to zoom. '}
        3D shading is illustrative — visibility and power come from the terrain-horizon profile.
      </p>

      {contextLost && (
        <div className="scene3d__lost" role="alert">
          <p>The 3D view lost its graphics context.</p>
          <button
            type="button"
            onClick={() => {
              setContextLost(false)
              setCanvasKey((k) => k + 1)
            }}
          >
            Reload 3D view
          </button>
        </div>
      )}
    </div>
  )
}
