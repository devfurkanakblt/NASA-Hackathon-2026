import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, ShaderMaterial, TextureLoader } from 'three'
import type { Texture } from 'three'
import gsap from 'gsap'
import { descentPose } from './descentPath.ts'
import type { DescentPose } from './descentPath.ts'
import { createMoonMaterial } from './moonMaterial.ts'
import type { SurfaceUniforms } from './moonMaterial.ts'
import { HeroTerrain, SunGlow } from './HeroTerrain.tsx'
import { Earth } from './Earth.tsx'

type MoonMaterial = ReturnType<typeof createMoonMaterial>
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

export const DESCENT_FOV = 32

export interface DescentProgress {
  /** Scroll progress 0..1, written only by the GSAP ScrollTrigger timeline. */
  value: number
  /** Set by the scene: request one frame (the canvas renders on demand). */
  invalidate?: () => void
}

interface SceneProps {
  progress: DescentProgress
  mobile: boolean
  onReady: () => void
  onError: () => void
}

const asset = (name: string, mobile: boolean) => `${import.meta.env.BASE_URL}assets/hero/${name}${mobile ? '-mobile' : ''}.webp`

function loadTexture(url: string, maxAnisotropy: number, global = false): Promise<Texture> {
  return new TextureLoader().loadAsync(url).then((texture) => {
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = Math.min(8, maxAnisotropy)
    if (global) {
      texture.wrapS = RepeatWrapping // longitude wraps
      texture.wrapT = ClampToEdgeWrapping
    } else {
      texture.wrapS = texture.wrapT = ClampToEdgeWrapping
    }
    return texture
  })
}

function Moon({ mobile, onReady, onError, moon, onPolar }: Omit<SceneProps, 'progress'> & { moon: MoonMaterial; onPolar: () => void }) {
  const { gl, invalidate } = useThree()
  const { material } = moon
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    let cancelled = false
    const owned: Texture[] = []
    const max = gl.capabilities.getMaxAnisotropy()
    // The global mosaic gates the first frame; the polar layers stream in behind it and fade up.
    loadTexture(asset('moon-global', mobile), max, true).then((texture) => {
      if (cancelled) return texture.dispose()
      owned.push(texture)
      material.uniforms.uGlobal.value = texture
      gl.initTexture(texture) // upload now, not on the first scroll frame
      invalidate()
      onReady()
      for (const [name, uniform, on] of [['moon-south-context', 'uContext', 'uContextOn'], ['moon-south-polar', 'uPolar', 'uPolarOn']] as const) {
        loadTexture(asset(name, mobile), max).then((layer) => {
          if (cancelled) return layer.dispose()
          owned.push(layer)
          material.uniforms[uniform].value = layer
          gl.initTexture(layer)
          gsap.to(material.uniforms[on], { value: 1, duration: 0.9, ease: 'power1.out', onUpdate: invalidate })
          if (uniform === 'uPolar') onPolar()
        }).catch(() => { /* The global mosaic still covers the pole, only at lower detail. */ })
      }
    }).catch(() => { if (!cancelled) onError() })
    return () => {
      cancelled = true
      gsap.killTweensOf([material.uniforms.uContextOn, material.uniforms.uPolarOn])
      owned.forEach((t) => t.dispose())
    }
  }, [gl, invalidate, material, mobile, onError, onReady, onPolar])

  useFrame(({ camera }) => {
    const h = Math.max(1e-6, camera.position.length() - 1)
    const t = Math.min(1, Math.max(0, (Math.log(0.35) - Math.log(h)) / (Math.log(0.35) - Math.log(0.03))))
    material.uniforms.uAdapt.value = t * t * (3 - 2 * t)
  })

  // Dense enough that the silhouette stays round at 10 km altitude (latitude step 0.7°).
  const segments = mobile ? [320, 192] : [512, 256]
  return (
    <mesh material={material}>
      <sphereGeometry args={[1, segments[0], segments[1]]} />
    </mesh>
  )
}

/** A sparse, faint star field: in a sunlit scene only the brightest stars would register. */
function Stars({ progress, count }: { progress: DescentProgress; count: number }) {
  const geometry = useMemo(() => {
    let seed = 1969
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const positions = new Float32Array(count * 3)
    const brightness = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const z = random() * 2 - 1, a = random() * Math.PI * 2, r = Math.sqrt(1 - z * z)
      positions.set([r * Math.cos(a) * 150, z * 150, r * Math.sin(a) * 150], i * 3)
      brightness[i] = Math.pow(random(), 6) * 0.9 + 0.08 // many faint, few bright
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('brightness', new BufferAttribute(brightness, 1))
    return g
  }, [count])
  const material = useMemo(() => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uOpacity: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float brightness;
      uniform float uPixelRatio;
      varying float vB;
      void main() {
        vB = brightness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.0 + brightness * 1.6) * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vB * uOpacity;
        gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * a, a);
      }`,
  }), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  const dpr = useThree((state) => state.viewport.dpr)
  useFrame(() => {
    material.uniforms.uPixelRatio.value = dpr
    // Stars fade as the sunlit surface fills the frame (exposure adapts to the bright ground).
    material.uniforms.uOpacity.value = 1 - Math.min(1, Math.max(0, (progress.value - 0.35) / 0.4))
  })
  return <points geometry={geometry} material={material} renderOrder={-1} />
}

function CameraRig({ progress, shared }: { progress: DescentProgress; shared: SurfaceUniforms }) {
  const { camera, size, invalidate } = useThree()
  const pose = useRef<DescentPose | undefined>(undefined)
  useEffect(() => {
    progress.invalidate = invalidate
    return () => { progress.invalidate = undefined }
  }, [invalidate, progress])
  useEffect(() => invalidate(), [size, invalidate])
  useFrame(() => {
    const p = descentPose(progress.value, DESCENT_FOV, size.width / Math.max(1, size.height), pose.current)
    pose.current = p
    // From the photographs' light to the scene Sun on the measured terrain, as the view levels out.
    shared.uReal.value = smoothstep(0.6, 0.86, progress.value)
    camera.position.copy(p.position)
    camera.up.copy(p.up)
    camera.lookAt(p.position.x + p.forward.x, p.position.y + p.forward.y, p.position.z + p.forward.z)
    // Near plane follows altitude: depth precision for the surface at 10 km and at 9000 km.
    const near = Math.max(0.00004, Math.min(0.1, p.altitude * 0.25))
    if (Math.abs(camera.near - near) > near * 0.01) { camera.near = near; camera.updateProjectionMatrix() }
  })
  return null
}

/**
 * A lost GPU context (driver reset, memory pressure) falls back to the still hero. The listener
 * is removed on unmount, before R3F deliberately releases the context, so leaving the page or a
 * hot reload is not mistaken for a failure.
 */
function ContextGuard({ onError }: { onError: () => void }) {
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onError() }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [canvas, onError])
  return null
}

export default function MoonScene({ progress, mobile, onReady, onError }: SceneProps) {
  const moon = useMemo(() => createMoonMaterial(), [])
  const [polarReady, setPolarReady] = useState(false)
  const onPolar = useMemo(() => () => setPolarReady(true), [])
  return (
    <Canvas
      frameloop="demand"
      dpr={mobile ? [1, 1.5] : [1, 2]}
      camera={{ fov: DESCENT_FOV, near: 0.1, far: 400, position: [0, 0, 6] }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      aria-hidden="true"
    >
      <color attach="background" args={['#000000']} />
      <ContextGuard onError={onError} />
      <CameraRig progress={progress} shared={moon.shared} />
      <Stars progress={progress} count={mobile ? 900 : 1800} />
      <Moon mobile={mobile} onReady={onReady} onError={onError} moon={moon} onPolar={onPolar} />
      {/* Measured LOLA terrain streams in after the photographs; the sphere covers the pole until then. */}
      {polarReady && <HeroTerrain mobile={mobile} shared={moon.shared} moonUniforms={moon.material.uniforms} />}
      <SunGlow shared={moon.shared} />
      {polarReady && <Earth />}
    </Canvas>
  )
}
