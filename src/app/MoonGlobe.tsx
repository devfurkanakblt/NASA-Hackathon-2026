import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMoonSurfaceTexture } from '../scene3d/moonSurfaceTexture.ts'
import { PolarMoonCap } from '../scene3d/PolarMoonCap.tsx'
import { ComputedAreas } from '../scene3d/ComputedAreas.tsx'
import { globeNearPlane } from '../scene3d/globeClip.ts'
import type { Mesh } from 'three'
import { GLOBE_NORTH_EDGE_DEG, southernCameraPosition } from './globeView.ts'
import { createMoonRoute, moonPosition, sampleMoonRoute } from './moonFlight.ts'
import type { CSSProperties } from 'react'
import type { LunarImageryDetail, MapDoc, SiteEntry } from '../data/contract.ts'

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

/** Keeps the whole-globe camera over the southern hemisphere, so the far side cannot be turned into view. */
function SouthernView() {
  useFrame(({ camera, invalidate }) => {
    const p = camera.position
    const [x, y, z] = southernCameraPosition([p.x, p.y, p.z])
    if (x !== p.x || y !== p.y || z !== p.z) {
      p.set(x, y, z)
      camera.lookAt(0, 0, 0)
      invalidate()
    }
  })
  return null
}

function GlobeClipPlanes() {
  useFrame(({ camera }) => {
    // A constant 0.0001 near plane loses depth precision when viewing the whole globe:
    // photograph layers then fight with the base sphere and look like radial streaks.
    const near = globeNearPlane(camera.position.length())
    if (Math.abs(camera.near - near) > 1e-8) { camera.near = near; camera.updateProjectionMatrix() }
  })
  return null
}

function PointCamera({ target }: { target: { latDeg: number; lonDeg: number } | null }) {
  const { camera, invalidate } = useThree()
  useEffect(() => {
    if (!target) return
    camera.position.copy(moonPosition(target).multiplyScalar(1.008))
    const lat = target.latDeg * Math.PI / 180, lon = target.lonDeg * Math.PI / 180
    camera.up.set(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon))
    camera.lookAt(0, 0, 0); invalidate()
  }, [target, camera, invalidate])
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

export default function MoonGlobe({ sites, maps = [], images, selected, onSelect, flight, onComplete, active = true }: {
  sites: SiteEntry[]; selected: MoonPlace[]; onSelect?: (site: SiteEntry) => void
  active?: boolean; flight?: MoonFlight; onComplete?: () => void
  maps?: MapDoc[]
  images?: Record<string, LunarImageryDetail>
}) {
  const moon = useRef<Mesh>(null!)
  const [poleRequest, setPoleRequest] = useState(0)
  const [focus, setFocus] = useState<{ latDeg: number; lonDeg: number; siteId?: string } | null>(null)
  const { texture, failed } = useMoonSurfaceTexture()
  return <div className="moon-globe" aria-label={flight ? 'Travelling between selected lunar locations' : 'Interactive Moon location selector'}>
    <Canvas frameloop={active ? 'demand' : 'never'} camera={{ position: [0, -2.8, .65], up: [0, 0, -1], fov: 42, near: .05, far: 30 }} dpr={[1, 1.75]}>
      <color attach="background" args={['#070a0f']} />
      <PoleCamera request={poleRequest} />
      <PointCamera target={focus} />
      <GlobeClipPlanes />
      {!flight && <SouthernView />}
      <ambientLight intensity={1.3} />
      <directionalLight position={[3, -4, 5]} intensity={2.5} />
      {/* Places are chosen by name only; the surface itself is not clickable. */}
      <group>
      {/* Southern hemisphere only (theta is measured from the north pole, +Y). */}
      <mesh ref={moon}><sphereGeometry args={[1, 128, 64, 0, Math.PI * 2, (90 - GLOBE_NORTH_EDGE_DEG) * Math.PI / 180, (90 + GLOBE_NORTH_EDGE_DEG) * Math.PI / 180]} />
        {texture ? <meshBasicMaterial map={texture} toneMapped={false} /> : <meshStandardMaterial color="#898985" roughness={1} />}
      </mesh>
      <PolarMoonCap />
      <ComputedAreas maps={maps} images={images} focusId={focus?.siteId} />
      </group>
      {(flight ? selected.map(p => p.site) : sites).map((site, i) => {
        const picks = selected.filter(p => p.site.id === site.id)
        const color = picks[0]?.color ?? '#ddd8cc'
        const position = moonPosition(site).multiplyScalar(1.0007)
        return <group key={`${site.id}-${i}`} position={position}>
          <mesh><sphereGeometry args={[.002, 12, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>
          <Html center occlude={[moon]} zIndexRange={[20, 0]} style={{ pointerEvents: flight ? 'none' : 'auto' }}>
            <svg className="moon-leader moon-leader--desktop" width="1" height="1" aria-hidden="true" style={{ color }}><line x1="0" y1="0" x2={(i % 3 - 1) * 190} y2={-45 - Math.floor(i / 3) * 50} /></svg>
            <svg className="moon-leader moon-leader--mobile" width="1" height="1" aria-hidden="true" style={{ color }}><line x1="0" y1="0" x2={(i % 2 ? 1 : -1) * 79} y2={-40 - Math.floor(i / 2) * 49} /></svg>
            <div className="moon-label" style={{ color, '--pin-x': `${(i % 3 - 1) * 190}px`, '--pin-y': `${-45 - Math.floor(i / 3) * 50}px`, '--pin-mobile-x': `${(i % 2 ? 1 : -1) * 79}px`, '--pin-mobile-y': `${-40 - Math.floor(i / 2) * 49}px` } as CSSProperties}>
            <button type="button" className="moon-pin" style={{ color }}
              onClick={() => { onSelect?.(site); setFocus({ latDeg: site.latDeg, lonDeg: site.lonDeg, siteId: site.id }) }} disabled={!!flight} title={picks.length ? 'Remove this place from the comparison' : 'Add this place to the comparison'} aria-pressed={picks.length > 0}>
              <span className="moon-pin__dot" />{picks.map(p => p.letter).join(' / ')}{picks.length ? ' · ' : ''}{site.name}
            </button></div>
          </Html>
        </group>
      })}
      {selected.filter(p => !sites.some(s => s.id === p.site.id)).map(p => <group key={p.key} position={moonPosition(p.site).multiplyScalar(1.001)}>
        <mesh><sphereGeometry args={[.00004, 10, 10]} /><meshBasicMaterial color={p.color} depthTest={false} /></mesh>
        <Html center occlude={[moon]} style={{ pointerEvents: 'none' }}><span style={{ color: p.color, background: '#10141c', padding: 4 }}>{p.letter}</span></Html>
      </group>)}
      {flight && onComplete ? <FlightCamera flight={flight} onComplete={onComplete} /> : <OrbitControls makeDefault enablePan={false} minDistance={1.001} maxDistance={4} enableDamping dampingFactor={.12} />}
    </Canvas>
    {!flight && <button type="button" style={{ position: 'absolute', left: 12, bottom: 50, zIndex: 25 }} onClick={() => setPoleRequest(n => n + 1)}>Focus south pole</button>}
    {!flight && <span className="moon-globe__hint">Southern hemisphere · Click a name to add or remove it (up to three) · Green areas have calculation data</span>}
    <span className="moon-globe__credit">{texture ? 'NASA/LROC WAC archive · Catalogue coordinates' : failed ? 'Image unavailable · Untextured catalogue locator' : 'Loading NASA/LROC imagery · Untextured globe'}</span>
  </div>
}
