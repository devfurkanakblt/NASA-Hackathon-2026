import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { useMoonSurfaceTexture } from '../scene3d/moonSurfaceTexture.ts'
import type { Mesh } from 'three'
import { createMoonRoute, moonPosition, sampleMoonRoute } from './moonFlight.ts'
import type { CSSProperties } from 'react'
import type { SiteEntry } from '../data/contract.ts'

export interface MoonPlace { key: string; site: SiteEntry; color: string; letter: string }
export interface MoonFlight { from: SiteEntry; to: SiteEntry }

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

export default function MoonGlobe({ sites, selected, onSelect, flight, onComplete, active = true }: {
  sites: SiteEntry[]; selected: MoonPlace[]; onSelect?: (site: SiteEntry) => void
  active?: boolean; flight?: MoonFlight; onComplete?: () => void
}) {
  const moon = useRef<Mesh>(null!)
  const { texture, failed } = useMoonSurfaceTexture()
  return <div className="moon-globe" aria-label={flight ? 'Travelling between selected lunar locations' : 'Interactive Moon location selector'}>
    <Canvas frameloop={active ? 'demand' : 'never'} camera={{ position: [0, -2.8, .65], up: [0, 0, -1], fov: 42, near: .0001, far: 30 }} dpr={[1, 1.75]}>
      <color attach="background" args={['#070a0f']} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[3, -4, 5]} intensity={2.5} />
      <mesh ref={moon}><sphereGeometry args={[1, 128, 96]} />
        {texture ? <meshBasicMaterial map={texture} toneMapped={false} /> : <meshStandardMaterial color="#898985" roughness={1} />}
      </mesh>
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
              onClick={() => onSelect?.(site)} disabled={!!flight || (!picks.length && selected.length >= 3)} aria-pressed={picks.length > 0}>
              <span className="moon-pin__dot" />{picks.map(p => p.letter).join(' / ')}{picks.length ? ' · ' : ''}{site.name}
            </button></div>
          </Html>
        </group>
      })}
      {flight && onComplete ? <FlightCamera flight={flight} onComplete={onComplete} /> : <OrbitControls makeDefault enablePan={false} minDistance={1.015} maxDistance={4} enableDamping dampingFactor={.12} />}
    </Canvas>
    {!flight && <span className="moon-globe__hint">Drag to rotate · Scroll to zoom · Select a labelled location</span>}
    <span className="moon-globe__credit">{texture ? 'NASA/LROC WAC archive · Catalogue coordinates' : failed ? 'Image unavailable · Untextured catalogue locator' : 'Loading NASA/LROC imagery · Untextured globe'}</span>
  </div>
}
