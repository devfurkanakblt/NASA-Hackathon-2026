import { Canvas } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Object3D } from 'three'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import type { QuaternionXyzw } from './appearance.ts'
import { useEarthTexture } from './earthTexture.ts'
import sourceLinks from './sources.json'
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
import { Diagnostics } from './parts/Diagnostics.tsx'
import { CompassPoints, HorizonCurtain, HorizonLines } from './parts/HorizonOverlay.tsx'
import { LabelProjector } from './parts/Labels.tsx'
import type { LabelBinding } from './parts/Labels.tsx'
import { Lander } from './parts/Lander.tsx'
import { DirectionArrow, SkyBody, SkyFollow, SkyTrack } from './parts/SkyBodies.tsx'
import { ReferenceSphere, Terrain } from './parts/Terrain.tsx'
import './scene3d.css'
import { buildTerrainMeshData, nestFarMesh } from './terrainGeometry.ts'
import type { BodyPath, BodyState, BodyStatus, CameraMode, HorizonProfile, LookTarget, PanelState, TerrainGrid, Vec3 } from './types.ts'

export interface MissionScene3DProps {
  /** Local elevation grid of the selected site (`terrain.json`). */
  terrain: TerrainGrid
  /** Coarse regional grid around it (`terrain-far.json`), drawn in the overview out to its edge. */
  farTerrain?: TerrainGrid
  /** Terrain horizon of the selected site (`horizon.json`). */
  horizon: HorizonProfile
  /** Sun / Earth at the current time step; `visible` comes from the simulation engine. */
  sun: BodyState
  earth: BodyState
  /** Real sky tracks over the period to show (e.g. the mission window), from `ephemeris.json`. */
  sunPath?: BodyPath
  earthPath?: BodyPath
  /** Earth-fixed axes registered in the local scene at the displayed UTC. */
  earthOrientation?: QuaternionXyzw
  /** Direction to the Sun evaluated at Earth, in the same local axes. */
  earthSunDirection?: Vec3
  /** Authoritative engine output, including optional partial-disc production. */
  panelPowerW?: number
  diagnostics?: boolean
  panel?: PanelState
  /** Elevation of the geometric (flat) horizon, drawn dashed. Default 0°. */
  geometricHorizonDeg?: number
  /** Observer height above ground. Default 2 m, as everywhere in the project. */
  observerHeightM?: number
  /** Height of the ground at the site above the 1737.4 km sphere (`sites.json`); draws that sphere in the overview. */
  surfaceElevationM?: number
  defaultCameraMode?: CameraMode
  defaultShowTerrainEffect?: boolean
}

/** Scene distances in units of half the terrain patch: sky sphere and camera far plane. */
const SKY_RADIUS = 75
const FAR_PLANE = 82

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
  farTerrain,
  horizon,
  sun,
  earth,
  sunPath,
  earthPath,
  earthOrientation,
  earthSunDirection,
  panelPowerW,
  diagnostics = false,
  panel = DEFAULT_PANEL,
  geometricHorizonDeg = 0,
  observerHeightM = OBSERVER_HEIGHT_M,
  surfaceElevationM,
  defaultCameraMode = 'overview',
  defaultShowTerrainEffect = false,
}: MissionScene3DProps) {
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaultCameraMode)
  const [showTerrainEffect, setShowTerrainEffect] = useState(defaultShowTerrainEffect)
  const [lookTarget, setLookTarget] = useState<LookTarget>('sun')
  const [contextLost, setContextLost] = useState(false)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [reliefLighting, setReliefLighting] = useState(true)
  const [canvasKey, setCanvasKey] = useState(0)
  const diagnosticOutput = useRef<HTMLOutputElement | null>(null)
  const { texture: earthMap, failed: earthMapFailed } = useEarthTexture()

  const meshData = useMemo(() => buildTerrainMeshData(terrain, observerHeightM), [terrain, observerHeightM])
  const half = meshData.halfExtentM
  const farMesh = useMemo(
    () => (farTerrain ? nestFarMesh(buildTerrainMeshData(farTerrain, observerHeightM), meshData) : null),
    [farTerrain, observerHeightM, meshData],
  )
  const overviewRadius = half * 0.9
  // Keep the full-resolution horizon silhouette beyond the measured regional mesh.
  const curtainRadius = Math.max(half * 2.2, (farTerrain?.sizeM ?? 0) * 0.75)
  // The sky sits far beyond the terrain patch and travels with the camera (see SkyFollow).
  // It must lie beyond the limb of the reference sphere as seen from the highest overview camera.
  const skyRadius = half * SKY_RADIUS
  const trackRadius = half * (SKY_RADIUS + 4)
  const lander = cameraMode === 'lander'

  const sunStatus = bodyStatus(sun, geometricHorizonDeg)
  const earthStatus = bodyStatus(earth, geometricHorizonDeg)
  const sunDirection = useMemo(() => azElToUnitVector(sun.azDeg, sun.elDeg), [sun.azDeg, sun.elDeg])
  const normal = useMemo(() => panelNormal(panel, { azDeg: sun.azDeg, elDeg: sun.elDeg }), [panel, sun.azDeg, sun.elDeg])
  const lit = panelPowerW === undefined ? panelIsLit(panel, sun) : panelPowerW > 0
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
        shadows="soft"
        dpr={[1.5, 2]}
        camera={{ fov: 45, near: 5, far: half * FAR_PLANE, position: [half, half * 0.5, half * 2.3] }}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1, outputColorSpace: SRGBColorSpace }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            setContextLost(true)
          })
        }}
      >
        <color attach="background" args={['#000000']} />
        <hemisphereLight args={['#f5f5f3', '#6c6c69', reliefLighting ? 0.75 : 0]} />
        {/* Inspection fill preserves visible relief without claiming measured lunar irradiance. */}
        <directionalLight position={[-12000, 12000, 16000]} intensity={reliefLighting ? 0.9 : 0} color="#f2f2f0" />
        {/* Local visibility does not turn off sunlight for every mountain in the region. */}
        <directionalLight
          position={[sunDirection[0] * 45000, sunDirection[1] * 45000, sunDirection[2] * 45000]}
          intensity={4}
          color="#fff8ed"
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-half * 1.3}
          shadow-camera-right={half * 1.3}
          shadow-camera-top={half * 1.3}
          shadow-camera-bottom={-half * 1.3}
          shadow-camera-near={30000}
          shadow-camera-far={60000}
          shadow-bias={-0.00001}
          shadow-normalBias={0.5}
        />

        <Terrain data={meshData} reliefTint={reliefLighting} />
        {farMesh && <Terrain data={farMesh} reliefTint={reliefLighting} />}
        {!lander && surfaceElevationM !== undefined && (
          <ReferenceSphere data={farMesh ?? meshData} siteElevationM={surfaceElevationM} outerRadiusM={half * (SKY_RADIUS - 5)} />
        )}
        {cameraMode === 'overview' && <Lander panelNormal={normal} panelLit={lit} panelAreaM2={panel.areaM2} northLabelAnchor={northLabel.anchor} />}

        <group position={[0, observerHeightM, 0]}>
          {cameraMode === 'overview' ? (
            <>
              {showTerrainEffect && <HorizonLines profile={horizon} radius={overviewRadius} geometricHorizonDeg={geometricHorizonDeg} />}
              {showAnnotations && <DirectionArrow color={SUN_COLOR} body={sun} status={sunStatus} labelAnchor={sunLabel.anchor} length={half * 0.42} />}
              {showAnnotations && <DirectionArrow color={EARTH_COLOR} body={earth} status={earthStatus} labelAnchor={earthLabel.anchor} length={half * 0.42} />}
            </>
          ) : (
            <>
              <HorizonCurtain profile={horizon} radius={curtainRadius} xray={showTerrainEffect} />
              {showTerrainEffect && <HorizonLines profile={horizon} radius={curtainRadius * 0.999} geometricHorizonDeg={geometricHorizonDeg} />}
              <CompassPoints radius={curtainRadius} anchors={compassAnchors} />
            </>
          )}
        </group>

        {/* Sun and Earth at their true direction and apparent size, with their real tracks. */}
        <SkyFollow>
          {showAnnotations && sunPath && <SkyTrack path={sunPath} color={SUN_COLOR} radius={trackRadius} />}
          {showAnnotations && earthPath && <SkyTrack path={earthPath} color={EARTH_COLOR} radius={trackRadius} />}
          <SkyBody
            kind="sun"
            color={SUN_COLOR}
            body={sun}
            status={sunStatus}
            radius={skyRadius}
            angularDiameterDeg={sunAngularDiameterDeg(sun.distanceM)}
            sunDirection={sunDirection}
            showAnnotations={showAnnotations}
            xray={lander && showTerrainEffect}
            labelAnchor={lander ? sunLabel.anchor : undefined}
          />
          <SkyBody
            kind="earth"
            color={EARTH_COLOR}
            body={earth}
            status={earthStatus}
            radius={skyRadius}
            angularDiameterDeg={earthAngularDiameterDeg(earth.distanceM)}
            sunDirection={earthSunDirection ?? sunDirection}
            earthOrientation={earthOrientation}
            showAnnotations={showAnnotations}
            xray={lander && showTerrainEffect}
            labelAnchor={lander ? earthLabel.anchor : undefined}
          />
        </SkyFollow>

        <CameraRig
          mode={cameraMode}
          halfExtentM={half}
          farPlaneM={half * FAR_PLANE}
          eyeHeightM={observerHeightM}
          lookTarget={lookTarget}
          sun={sun}
          earth={earth}
          onUserLook={freeLook}
          terrainMesh={meshData}
          regionalMesh={farMesh ?? undefined}
        />
        <LabelProjector bindings={labels} />
        {diagnostics && <Diagnostics output={diagnosticOutput} />}
      </Canvas>

      <div className="scene3d__labels" style={{ display: showAnnotations ? undefined : 'none' }}>
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
        <label className="scene3d__check">
          <input type="checkbox" checked={showAnnotations} onChange={e => setShowAnnotations(e.target.checked)} />
          Annotations
        </label>
        <label className="scene3d__check">
          <input type="checkbox" checked={reliefLighting} onChange={e => setReliefLighting(e.target.checked)} />
          Relief lighting (view aid)
        </label>
      </div>

      {diagnostics && <output ref={diagnosticOutput} className="scene3d__diagnostics">Rendering diagnostics…</output>}

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

      <details className="scene3d__data">
        <summary>NASA data · terrain scale 1:1 · model limits</summary>
        <p className="scene3d__note">
        {lander
          ? 'Drag to look, scroll to zoom. '
          : farMesh
            ? 'Lander not to scale; arrows point from it to the Sun and Earth. Around the detailed 10 km patch the region is drawn from a coarse LOLA grid. '
            : 'Lander not to scale; arrows point from it to the Sun and Earth. Beyond the terrain patch only the smooth reference sphere is drawn. '}
        Terrain scale 1:1. Sun/Earth directions and sizes follow the ephemeris. Mesh shadows are approximate; visibility and power use the full horizon profile.
        {!earthOrientation ? ' Earth map hidden: registered orientation is unavailable.'
          : earthMapFailed ? ' Earth map unavailable; an untextured illuminated sphere is shown.'
          : !earthMap ? ' Earth texture loading.' : ' Earth: NASA November 2004 composite, UTC-registered rotation; not live weather.'}
        {reliefLighting && ' Relief fill light is enabled for readability; switch it off to inspect Sun-only shading.'}
        </p>
        <p className="scene3d__note">Sources: <a href={sourceLinks.moonTrek} target="_blank" rel="noreferrer">NASA Moon Trek / LOLA</a> · <a href={sourceLinks.blueMarble} target="_blank" rel="noreferrer">NASA Blue Marble</a></p>
      </details>

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
