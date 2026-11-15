import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Object3D } from 'three'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import type { QuaternionXyzw } from './appearance.ts'
import { useEarthTexture } from './earthTexture.ts'
import { useTerrainNormalTexture } from './terrainNormalTexture.ts'
import { useLunarImageryTexture } from './lunarImageryTexture.ts'
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
import { LANDER_MODEL_RADIUS_M, Lander } from './parts/Lander.tsx'
import { DirectionArrow, SkyBody, SkyFollow, SkyTrack } from './parts/SkyBodies.tsx'
import { ReferenceSphere, Terrain } from './parts/Terrain.tsx'
import './scene3d.css'
import { getPreparedTerrain } from './terrainCache.ts'
import type { BodyPath, BodyState, BodyStatus, CameraMode, HorizonProfile, LookTarget, PanelState, TerrainGrid, Vec3 } from './types.ts'

export interface MissionScene3DProps {
  onReady?: () => void
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
  /** A date-specific display coverage warning; never affects engine visibility. */
  earthDisplayWarning?: string
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
  animateArrival?: boolean
  defaultCameraMode?: CameraMode
  defaultShowTerrainEffect?: boolean
}

/** Scene distances in units of half the terrain patch: sky sphere and camera far plane. */
const SKY_RADIUS = 75
/** Lander display scale as a fraction of half the terrain patch (150x for a 10 km patch). */
const LANDER_SCALE_PER_HALF_EXTENT = 0.03
/** Night-side brightness of the Earth view aid; the sunlit part stays about twice as bright. */
const EARTH_FILL_VIEW_AID = 0.45
const FAR_PLANE = 82

/** Signal only after the first draw has uploaded buffers and compiled the scene's shaders. */
function SceneReady({ terrain, onReady }: { terrain: TerrainGrid; onReady?: () => void }) {
  const state = useRef({ terrain, frames: 0 })
  const invalidate = useThree(s => s.invalidate)
  useFrame(() => {
    if (!onReady) return
    if (state.current.terrain !== terrain) state.current = { terrain, frames: 0 }
    if (state.current.frames >= 2) return
    state.current.frames++
    if (state.current.frames === 2) onReady()
    else invalidate()
  })
  return null
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
  onReady,
  terrain,
  farTerrain,
  horizon,
  sun,
  earth,
  sunPath,
  earthPath,
  earthOrientation,
  earthSunDirection,
  earthDisplayWarning,
  panelPowerW,
  diagnostics = false,
  panel = DEFAULT_PANEL,
  geometricHorizonDeg = 0,
  observerHeightM = OBSERVER_HEIGHT_M,
  surfaceElevationM,
  animateArrival = false,
  defaultCameraMode = 'map',
  defaultShowTerrainEffect = false,
}: MissionScene3DProps) {
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaultCameraMode)
  const [showTerrainEffect, setShowTerrainEffect] = useState(defaultShowTerrainEffect)
  const [lookTarget, setLookTarget] = useState<LookTarget>('sun')
  const [contextLost, setContextLost] = useState(false)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [reliefLighting, setReliefLighting] = useState(true)
  const [earthFill, setEarthFill] = useState(true)
  const [showImagery, setShowImagery] = useState(true)
  const [canvasKey, setCanvasKey] = useState(0)
  const diagnosticOutput = useRef<HTMLOutputElement | null>(null)
  const scaleLine = useRef<HTMLSpanElement | null>(null)
  const scaleLabel = useRef<HTMLOutputElement | null>(null)
  const mapScale = useMemo(() => ({ line: scaleLine, label: scaleLabel }), [])
  const { texture: earthMap, failed: earthMapFailed } = useEarthTexture()
  const { texture: detailNormal, failed: detailNormalFailed } = useTerrainNormalTexture(terrain.normalDetail?.textureUrl,
    terrain.normalDetail ? terrain.sizeM / terrain.normalDetail.manifest.sizeM : 1)
  const localImagery = terrain.imagery ?? farTerrain?.imagery
  const { texture: localPhoto, failed: localPhotoFailed } = useLunarImageryTexture(localImagery?.textureUrl,
    terrain.sizeM, localImagery?.manifest.sizeM ?? terrain.sizeM)
  const { texture: regionalPhoto, failed: regionalPhotoFailed } = useLunarImageryTexture(farTerrain?.imagery?.textureUrl,
    farTerrain?.sizeM ?? terrain.sizeM, farTerrain?.imagery?.manifest.sizeM ?? farTerrain?.sizeM ?? terrain.sizeM)
  const hasImagery = Boolean(localImagery || farTerrain?.imagery)
  const imageryActive = showImagery && Boolean(localPhoto || regionalPhoto)

  const { meshData, farMesh } = useMemo(() => getPreparedTerrain(terrain, farTerrain, observerHeightM), [terrain, farTerrain, observerHeightM])
  const half = meshData.halfExtentM
  // One fixed enlargement of the lander (about 360 m across on a 10 km patch); the orbit
  // camera keeps a matching minimum distance so it never ends up inside the model.
  const landerScale = half * LANDER_SCALE_PER_HALF_EXTENT
  const minOrbitDistanceM = LANDER_MODEL_RADIUS_M * landerScale * 2.5
  const overviewRadius = half * 0.9
  // Keep the full-resolution horizon silhouette beyond the measured regional mesh.
  const curtainRadius = Math.max(half * 2.2, (farTerrain?.sizeM ?? 0) * 0.75)
  // The sky sits far beyond the terrain patch and travels with the camera (see SkyFollow).
  // It must lie beyond the limb of the reference sphere as seen from the highest overview camera.
  const skyRadius = half * SKY_RADIUS
  const trackRadius = half * (SKY_RADIUS + 4)
  const lander = cameraMode === 'lander'
  const mapView = cameraMode === 'map'

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
      <div className="scene3d__viewport">
      <Canvas
        key={canvasKey}
        frameloop="demand"
        shadows="percentage"
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
        <SceneReady terrain={terrain} onReady={onReady} />
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

        <Terrain data={meshData} reliefTint={reliefLighting} detailNormal={detailNormal} imageryTexture={showImagery ? localPhoto : null} />
        {farMesh && <Terrain data={farMesh} reliefTint={reliefLighting} imageryTexture={showImagery ? regionalPhoto : null} />}
        {cameraMode === 'overview' && surfaceElevationM !== undefined && (
          <ReferenceSphere data={farMesh ?? meshData} siteElevationM={surfaceElevationM} outerRadiusM={half * (SKY_RADIUS - 5)} />
        )}
        {cameraMode === 'overview' && <Lander panelNormal={normal} panelLit={lit} panelAreaM2={panel.areaM2} northLabelAnchor={northLabel.anchor} displayScale={landerScale} />}

        <group position={[0, observerHeightM, 0]}>
          {!lander ? (
            <>
              {!mapView && showTerrainEffect && <HorizonLines profile={horizon} radius={overviewRadius} geometricHorizonDeg={geometricHorizonDeg} />}
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
        {!mapView && <SkyFollow>
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
            earthFill={earthFill ? EARTH_FILL_VIEW_AID : 0}
            showAnnotations={showAnnotations}
            xray={lander && showTerrainEffect}
            labelAnchor={lander ? earthLabel.anchor : undefined}
          />
        </SkyFollow>}

        <CameraRig
          animateArrival={animateArrival}
          mode={cameraMode}
          halfExtentM={half}
          minOrbitDistanceM={minOrbitDistanceM}
          farPlaneM={half * FAR_PLANE}
          eyeHeightM={observerHeightM}
          lookTarget={lookTarget}
          sun={sun}
          earth={earth}
          onUserLook={freeLook}
          terrainMesh={meshData}
          regionalMesh={farMesh ?? undefined}
          mapScale={mapScale}
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

      {mapView && <div className="scene3d__map-tools" aria-label="Map orientation and scale">
        <strong aria-label="North is up">N ↑</strong>
        <div className="scene3d__map-scale" title="Metric scale at the centre of the map">
          <span ref={scaleLine} />
          <output ref={scaleLabel}>Scale at centre</output>
        </div>
      </div>}
      {showImagery && hasImagery && <div className="scene3d__imagery-status" role="note">
        {imageryActive ? 'NASA archive imagery; image shadows are not selected UTC'
          : localPhotoFailed || regionalPhotoFailed ? 'NASA image unavailable; DEM shading is shown.' : 'Loading NASA archive imagery…'}
        {imageryActive && (localPhotoFailed || regionalPhotoFailed) && ' Some imagery is unavailable.'}
      </div>}

      </div>
      <div className="scene3d__toolbar">
        <div className="scene3d__segmented" role="group" aria-label="Camera">
          <button type="button" aria-pressed={mapView} onClick={() => setCameraMode('map')}>
            Map view
          </button>
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
        {cameraMode === 'lander' && <label className="scene3d__check" title="Brightens Earth's night side so the disc can be found; the true phase stays visible as the brighter part">
          <input type="checkbox" checked={earthFill} onChange={e => setEarthFill(e.target.checked)} />
          Earth fill light (view aid)
        </label>}
        <label className="scene3d__check" title={hasImagery ? 'Show the georegistered NASA archive photograph' : 'Archive imagery is not available for this site'}>
          <input type="checkbox" checked={showImagery && hasImagery} disabled={!hasImagery} onChange={e => setShowImagery(e.target.checked)} />
          NASA imagery
        </label>
        {!mapView && <label className="scene3d__check">
          <input type="checkbox" checked={showTerrainEffect} onChange={(e) => setShowTerrainEffect(e.target.checked)} />
          Show terrain effect
        </label>}
        <label className="scene3d__check">
          <input type="checkbox" checked={showAnnotations} onChange={e => setShowAnnotations(e.target.checked)} />
          Annotations
        </label>
        {!imageryActive && <label className="scene3d__check">
          <input type="checkbox" checked={reliefLighting} onChange={e => setReliefLighting(e.target.checked)} />
          Relief lighting (view aid)
        </label>}
      </div>

      {diagnostics && <output ref={diagnosticOutput} className="scene3d__diagnostics">Rendering diagnostics…</output>}

      {!mapView && showTerrainEffect && (
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
        {mapView ? 'North is up. Drag to pan; scroll or pinch to zoom. Scale is measured at the map centre. ' : lander
          ? 'Drag to look, scroll to zoom. '
          : farMesh
            ? 'Lander not to scale; arrows point from it to the Sun and Earth. Around the detailed 10 km patch the region is drawn from a coarse LOLA grid. '
            : 'Lander not to scale; arrows point from it to the Sun and Earth. Beyond the terrain patch only the smooth reference sphere is drawn. '}
        Terrain scale 1:1. Sun/Earth directions and sizes follow the ephemeris. Mesh shadows are approximate; visibility and power use the full horizon profile.
        {!earthOrientation ? ` ${earthDisplayWarning ?? 'Earth map hidden: registered orientation is unavailable.'}`
          : earthMapFailed ? ' Earth map unavailable; an untextured illuminated sphere is shown.'
          : !earthMap ? ' Earth texture loading.' : ' Earth: NASA November 2004 composite, UTC-registered rotation; not live weather.'}
        {lander && earthFill && ' Earth fill light (view aid) brightens its night side; the brighter part is the true phase.'}
        {imageryActive ? ' Surface photographs are NASA archival composites; their combined lighting does not depict the selected UTC. Switch NASA imagery off for modelled Sun-direction shading.'
          : reliefLighting && ' Relief fill light is enabled for readability; switch it off to inspect Sun-only shading.'}
        {!imageryActive && terrain.normalDetail && (detailNormalFailed ? ' Measured surface detail unavailable; mesh shading is used.'
          : detailNormal ? ` Surface shading: normals from NASA ${terrain.normalDetail.manifest.sourceNativePixelM} m DEM; geometry and visibility stay separate.`
          : ' Measured surface detail loading.')}
        </p>
        <p className="scene3d__note">Sources: <a href={sourceLinks.moonTrek} target="_blank" rel="noreferrer">NASA Moon Trek / LOLA</a> · <a href={sourceLinks.lrocMosaic} target="_blank" rel="noreferrer">LROC lunar imagery</a> · <a href={sourceLinks.blueMarble} target="_blank" rel="noreferrer">NASA Blue Marble</a></p>
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
