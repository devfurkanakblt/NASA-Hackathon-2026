import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalMoonSurface } from '../scene3d/GlobalMoonSurface.tsx'
import { useGlobalTerrain } from '../scene3d/useGlobalTerrain.ts'
import { useMoonSurfaceTexture } from '../scene3d/moonSurfaceTexture.ts'
import { terrainRadius } from '../scene3d/globalTerrain.ts'
import type { GlobalTerrain } from '../scene3d/globalTerrain.ts'
import { globeNearPlane } from '../scene3d/globeClip.ts'
import { Vector3 } from 'three'
import type { Mesh } from 'three'
import { separateGlobeLabel, labelOffset } from './globeView.ts'
import type { LabelBox } from './globeView.ts'
import { createMoonRoute, moonLatLon, moonPosition, sampleMoonRoute } from './moonFlight.ts'
import { PlaceInfo } from './PlaceInfo.tsx'
import type { ResearchSummary } from './PlaceInfo.tsx'
import type { CSSProperties } from 'react'
import type { SiteEntry } from '../data/contract.ts'

export interface MoonPlace { key: string; site: SiteEntry; color: string; letter: string }
export interface MoonFlight { from: SiteEntry; to: SiteEntry }

function PoleCamera({ request }: { request: number }) {
  const { camera, invalidate } = useThree()
  useEffect(() => {
    if (!request) return
    camera.position.set(0, -1.18, .01)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    invalidate()
  }, [request, camera, invalidate])
  return null
}

function GlobeClipPlanes({ terrain }: { terrain: GlobalTerrain | null }) {
  useFrame(({ camera }) => {
    // Keep the camera above the measured terrain, including positive elevations.
    const ground = terrainRadius(terrain, camera.position, 1000)
    if (camera.position.length() < ground) camera.position.setLength(ground)
    // A constant 0.0001 near plane loses depth precision when viewing the whole globe:
    // photograph layers then fight with the base sphere and look like radial streaks.
    const near = globeNearPlane(camera.position.length())
    if (Math.abs(camera.near - near) > 1e-8) { camera.near = near; camera.updateProjectionMatrix() }
  })
  return null
}

function FirstFrame({ onFrame }: { onFrame: () => void }) {
  const done = useRef(false)
  useFrame(() => { if (!done.current) { done.current = true; onFrame() } })
  return null
}

interface LabelRefs { label: HTMLDivElement | null; line: SVGLineElement | null }

/**
 * Pulls each place label back inside the globe frame when its usual offset would put it off
 * screen, and points its leader line at the moved label. Runs on every drawn frame.
 */
function KeepLabelsInFrame({ positions, refs }: { positions: Vector3[]; refs: { current: LabelRefs[] } }) {
  const projected = useMemo(() => new Vector3(), [])
  const frames = useRef(0)
  useFrame(({ camera, size, invalidate }) => {
    const mobile = window.matchMedia('(max-width: 640px)').matches
    // Labels mount in their own roots a few frames after this; the canvas only draws on
    // demand, so keep drawing briefly until they can be measured. Labels hidden behind
    // the rim measure 0 and are skipped; turning the globe draws new frames anyway.
    let unmeasured = false
    const placed: LabelBox[] = [{ x: 76, y: 29, w: 128, h: 38 }]
    // Leave room for the floating comparison controls, particularly in a narrow window.
    const labelFrame = { w: size.width, h: Math.max(0, size.height - (mobile ? 90 : 45)) }
    positions.forEach((position, i) => {
      const { label, line } = refs.current[i] ?? {}
      if (!label?.offsetWidth) { unmeasured = true; return }
      const offset = labelOffset(i)
      const pin = mobile ? { x: offset.mobileX, y: offset.mobileY } : { x: offset.x, y: offset.y }
      projected.copy(position).project(camera)
      const anchor = { x: (projected.x + 1) / 2 * size.width, y: (1 - projected.y) / 2 * size.height }
      const box = separateGlobeLabel(anchor, pin, { w: label.offsetWidth, h: label.offsetHeight }, labelFrame, placed)
      placed.push(box)
      const shift = { x: box.x - anchor.x - pin.x, y: box.y - anchor.y - pin.y }
      label.style.setProperty('--pin-shift-x', `${shift.x}px`)
      label.style.setProperty('--pin-shift-y', `${shift.y}px`)
      line?.setAttribute('x2', String(pin.x + shift.x))
      line?.setAttribute('y2', String(pin.y + shift.y))
    })
    if (unmeasured && frames.current++ < 120) invalidate()
  })
  return null
}

function FlightCamera({ flight, onComplete }: { flight: MoonFlight; onComplete: () => void }) {
  const { camera, invalidate } = useThree()
  useEffect(() => {
    const position = camera.position.clone(), rotation = camera.quaternion.clone(), up = camera.up.clone()
    return () => { camera.position.copy(position); camera.quaternion.copy(rotation); camera.up.copy(up); invalidate() }
  }, [camera, invalidate])
  const elapsed = useRef(0)
  const done = useRef(false)
  const reduced = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const path = useMemo(() => createMoonRoute(flight.from, flight.to), [flight])
  useFrame(({ camera }, delta) => {
    if (done.current) return
    invalidate()
    elapsed.current += Math.min(delta, .05)
    const t = Math.min(1, elapsed.current / (reduced.current ? .15 : 2.2))
    const { direction, distance } = sampleMoonRoute(path, t)
    camera.position.copy(direction.clone().multiplyScalar(reduced.current ? 2.595 : distance))
    camera.up.set(0, 0, -1)
    camera.lookAt(direction)
    if (t === 1) { done.current = true; onComplete() }
  })
  return null
}

export default function MoonGlobe({ sites, selected, onSelect, onPickPoint, researchFor, flight, onComplete, active = true }: {
  sites: SiteEntry[]; selected: MoonPlace[]; onSelect?: (site: SiteEntry) => void
  /** Short Research-tab summary of a catalogue place for the label's info window (computed on open). */
  researchFor?: (siteId: string) => ResearchSummary | null
  /** A click on the surface itself (not a label, not a drag): the clicked latitude / longitude. */
  onPickPoint?: (latDeg: number, lonDeg: number) => void
  active?: boolean; flight?: MoonFlight; onComplete?: () => void
}) {
  const moon = useRef<Mesh>(null!)
  const occluder = useRef<Mesh>(null!)
  const [poleRequest, setPoleRequest] = useState(0)
  // drei <Html> roots created while the canvas is still being set up can come out empty
  // (the first place label went missing). Mount the labels on the first frame after setup.
  const [labelsReady, setLabelsReady] = useState(false)
  // Keep the pole readable: chosen places carry labels; other places are named on hover.
  // This is a label budget only: every chosen point remains in the comparison and on the globe.
  const labelSites = useMemo(() => [...new Map(selected.map(p => [p.site.id, p.site])).values()].slice(-4), [selected])
  const dotSites = useMemo(() => flight ? [] : [...new Map([...sites, ...selected.map(p => p.site)].map(site => [site.id, site])).values()]
    .filter(site => !labelSites.some(label => label.id === site.id)), [flight, sites, selected, labelSites])
  const { terrain, error } = useGlobalTerrain()
  const photograph = useMoonSurfaceTexture()
  const displayPosition = (site: SiteEntry) => {
    const direction = moonPosition(site)
    return direction.multiplyScalar(terrainRadius(terrain, direction, 200))
  }
  const labelPositions = useMemo(() => labelSites.map(site => {
    const direction = moonPosition(site)
    return direction.multiplyScalar(terrainRadius(terrain, direction, 200))
  }), [labelSites, terrain])
  const labelRefs = useRef<LabelRefs[]>([])
  return <div className="moon-globe" aria-label={flight ? 'Travelling between selected lunar locations' : 'Interactive Moon location selector'}>
    <Canvas frameloop={active ? 'demand' : 'never'} camera={{ position: [0, -2.8, .65], up: [0, 0, -1], fov: 42, near: .05, far: 30 }} dpr={[1, 1.75]}>
      <color attach="background" args={['#070a0f']} />
      <PoleCamera request={poleRequest} />
      <GlobeClipPlanes terrain={terrain} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[3, -4, 5]} intensity={2.5} />
      <group onClick={(e) => {
        if (!onPickPoint || flight || e.delta > 4) return
        e.stopPropagation()
        const local = moon.current.worldToLocal(e.point.clone())
        const { latDeg, lonDeg } = moonLatLon(local)
        onPickPoint(latDeg, lonDeg)
      }}>
      <GlobalMoonSurface terrain={terrain} meshRef={moon} refine={!flight} />
      </group>
      {/* Label occlusion raycasts every label on every frame; against the ~260k-triangle terrain
          mesh that stalls the flight. A hidden low-poly sphere just under the lowest terrain
          (~-9 km, 0.9948 R) hides labels on the far side at a fraction of the cost. */}
      <mesh ref={occluder} visible={false}><sphereGeometry args={[.994, 48, 24]} /></mesh>
      {!labelsReady && <FirstFrame onFrame={() => setLabelsReady(true)} />}
      {labelsReady && <KeepLabelsInFrame positions={labelPositions} refs={labelRefs} />}
      {labelsReady && labelSites.map((site, i) => {
        const picks = selected.filter(p => p.site.id === site.id)
        const color = picks[0]?.color ?? '#ddd8cc'
        const position = labelPositions[i]
        const pin = labelOffset(i)
        const refs = (labelRefs.current[i] ??= { label: null, line: null })
        return <group key={`${site.id}-${i}`} position={position}>
          <mesh><sphereGeometry args={[.002, 12, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>
          <Html center occlude={[occluder]} zIndexRange={[20, 0]} style={{ pointerEvents: flight ? 'none' : 'auto' }}>
            <svg className="moon-leader" width="1" height="1" aria-hidden="true" style={{ color }}><line ref={el => { refs.line = el }} x1="0" y1="0" x2={pin.x} y2={pin.y} /></svg>
            <div ref={el => { refs.label = el }} className="moon-label" style={{ color, '--pin-x': `${pin.x}px`, '--pin-y': `${pin.y}px`, '--pin-mobile-x': `${pin.mobileX}px`, '--pin-mobile-y': `${pin.mobileY}px` } as CSSProperties}>
            <button type="button" className="moon-pin" style={{ color }}
              onClick={() => onSelect?.(site)} disabled={!!flight} title={picks.length ? 'Remove this place from the comparison' : 'Add this place to the comparison'} aria-pressed={picks.length > 0}>
              <span className="moon-pin__dot" />{picks.map(p => p.letter).join(' / ')}{picks.length ? ' · ' : ''}{site.name}
            </button>{!flight && <PlaceInfo site={site} research={researchFor} />}</div>
          </Html>
        </group>
      })}
      {labelsReady && dotSites.map(site => <group key={site.id} position={displayPosition(site)}>
        <Html center occlude={[occluder]} zIndexRange={[19, 0]}>
          <button type="button" className="moon-dot" style={{ color: selected.find(p => p.site.id === site.id)?.color }} onClick={() => onSelect?.(site)} aria-pressed={selected.some(p => p.site.id === site.id)} aria-label={`${selected.some(p => p.site.id === site.id) ? 'Remove' : 'Add'} ${site.name} ${selected.some(p => p.site.id === site.id) ? 'from' : 'to'} the comparison`}>
            <span className="moon-dot__name" aria-hidden="true">{selected.filter(p => p.site.id === site.id).map(p => p.letter).join(' / ')} {site.name}</span>
          </button>
        </Html>
      </group>)}
      {flight && onComplete ? <FlightCamera flight={flight} onComplete={onComplete} /> : <OrbitControls makeDefault enablePan={false} minDistance={1.001} maxDistance={4} enableDamping dampingFactor={.12} />}
    </Canvas>
    {!flight && <button type="button" style={{ position: 'absolute', left: 12, top: 12, zIndex: 25 }} onClick={() => setPoleRequest(n => n + 1)}>Focus south pole</button>}
    {!flight && <span className="moon-globe__hint">Rotate the whole Moon · Hover a dot for its name · Click the surface to compare a point · Scroll to zoom</span>}
    <span className="moon-globe__credit" title="Archival LROC photographs show their original illumination, not the selected mission time. Display terrain uses the shared NASA LOLA global tiles at ~1.9 km per pixel, true height; the mesh refines on zoom without adding source detail. Scientific coverage and precision are reported with each result.">{terrain ? 'NASA LOLA terrain · ~1.9 km/px' : error ? 'Terrain unavailable · Locator only' : 'Loading checked NASA LOLA terrain…'} · {photograph.texture ? 'LROC archive imagery' : photograph.failed ? 'Global image unavailable' : 'Loading global image…'}</span>
  </div>
}
