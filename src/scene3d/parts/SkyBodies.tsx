import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { AdditiveBlending, Color } from 'three'
import type { Group } from 'three'
import { DEG2RAD } from '../coords.ts'
import { STATUS_COLOR } from '../palette.ts'
import { skyPathLine } from '../sky.ts'
import type { BodyPath, BodyState, BodyStatus, Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

/** Angular radius of the ring that marks a body in the sky. */
const RETICLE_RADIUS_DEG = 1.6
const RETICLE_SEGMENTS = 48
/** Brightness of a track where the body is not in view, relative to where it is. */
const HIDDEN_TRACK_TINT = 0.32

/**
 * Euler rotation (order YXZ) that turns the local −Z axis towards azimuth / elevation while
 * keeping local +Y "up". Everything about a body is built once along −Z and then only rotated,
 * so stepping through time never rebuilds geometry or materials.
 */
function aimRotation(body: Pick<BodyState, 'azDeg' | 'elDeg'>): [number, number, number, 'YXZ'] {
  return [body.elDeg * DEG2RAD, -body.azDeg * DEG2RAD, 0, 'YXZ']
}

/**
 * Holds the sky. The Sun and Earth are so far away that they lie in the same direction from
 * anywhere in the scene, so this group travels with the camera: its children are effectively
 * at infinity and keep their true direction and apparent size in both camera modes.
 */
export function SkyFollow({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position)
  })
  return <group ref={group}>{children}</group>
}

// Earth is a sphere lit from the Sun's direction, which gives its real phase. Oceans, land,
// cloud and the thin blue limb are procedural — an illustrative surface, not an image of Earth.
const EARTH_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vLocal;
  void main() {
    vLocal = normalize(position);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`
const EARTH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vLocal;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1) + 0.15 * noise(p * 4.3); }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 view = normalize(cameraPosition - vWorldPosition);
    float day = smoothstep(-0.06, 0.14, dot(n, uSunDirection));
    float land = smoothstep(0.52, 0.6, fbm(vLocal * 2.4 + 3.1));
    float cloud = smoothstep(0.5, 0.72, fbm(vLocal * 4.0 + vec3(0.0, 7.3, 1.9)));
    vec3 surface = mix(uColor * 0.75, vec3(0.30, 0.42, 0.24), land);
    surface = mix(surface, vec3(0.95), cloud * 0.85);
    float rim = pow(1.0 - max(dot(n, view), 0.0), 2.5);
    vec3 color = surface * (0.03 + 0.97 * day) + vec3(0.35, 0.6, 1.0) * rim * (0.15 + 0.85 * day);
    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`

// Soft glare around the Sun's disc. The disc itself keeps its true size; the glare only helps find it.
const GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const GLOW_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5)) * 2.0;
    float glow = pow(max(1.0 - d, 0.0), 2.6);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.68) * glow * uOpacity, 1.0);
    #include <colorspace_fragment>
  }
`
/** Glare radius as a multiple of the Sun's disc radius. */
const GLOW_SCALE = 9

export interface SkyBodyProps {
  kind: 'sun' | 'earth'
  color: string
  body: BodyState
  status: BodyStatus
  /** Distance of the sky sphere from the viewer. */
  radius: number
  /** True apparent diameter of the disc. */
  angularDiameterDeg: number
  /** Unit vector towards the Sun in the scene frame (lights Earth's disc). */
  sunDirection: Vec3
  /** Draw a body that is not in view through the terrain, to show where it is. */
  xray: boolean
  /** Where the body's text label is pinned; omit to leave the label elsewhere. */
  labelAnchor?: AnchorRef
}

/**
 * The Sun or Earth in the sky: a disc at its true apparent size, hidden by whatever terrain is
 * in front of it, plus a ring that always shows where it is.
 */
export function SkyBody({ kind, color, body, status, radius, angularDiameterDeg, sunDirection, xray, labelAnchor }: SkyBodyProps) {
  const reticleRadius = radius * Math.tan(RETICLE_RADIUS_DEG * DEG2RAD)
  const reticle = useMemo(() => {
    const points: Vec3[] = []
    for (let i = 0; i <= RETICLE_SEGMENTS; i++) {
      const t = (i / RETICLE_SEGMENTS) * Math.PI * 2
      points.push([Math.cos(t) * reticleRadius, Math.sin(t) * reticleRadius, -radius])
    }
    return points
  }, [radius, reticleRadius])
  const earthUniforms = useMemo(() => ({ uColor: { value: new Color() }, uSunDirection: { value: [0, 1, 0] as Vec3 }, uOpacity: { value: 1 } }), [])

  const glowUniforms = useMemo(() => ({ uOpacity: { value: 1 } }), [])

  const visible = status === 'visible'
  const through = !visible && xray
  const opacity = through ? 0.6 : 1
  const discRadius = radius * Math.tan((angularDiameterDeg / 2) * DEG2RAD)

  return (
    <group rotation={aimRotation(body)}>
      {kind === 'sun' && (
        <mesh position={[0, 0, -radius * 1.01]} renderOrder={-1}>
          <circleGeometry args={[discRadius * GLOW_SCALE, 48]} />
          <shaderMaterial
            vertexShader={GLOW_VERTEX}
            fragmentShader={GLOW_FRAGMENT}
            uniforms={glowUniforms}
            uniforms-uOpacity-value={through ? 0.35 : 0.9}
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh position={[0, 0, -radius]} renderOrder={through ? 9 : 0}>
        <sphereGeometry args={[discRadius, 64, 32]} />
        {kind === 'sun' ? (
          <meshBasicMaterial key={through ? 'through' : 'solid'} color="#fff3d2" toneMapped={false} transparent={through} opacity={opacity} depthTest={!through} />
        ) : (
          <shaderMaterial
            key={through ? 'through' : 'solid'}
            vertexShader={EARTH_VERTEX}
            fragmentShader={EARTH_FRAGMENT}
            uniforms={earthUniforms}
            uniforms-uColor-value={color}
            uniforms-uSunDirection-value={sunDirection}
            uniforms-uOpacity-value={opacity}
            transparent={through}
            depthTest={!through}
          />
        )}
      </mesh>
      <Line
        points={reticle}
        color={STATUS_COLOR[status] ?? color}
        lineWidth={1.5}
        dashed={!visible}
        dashSize={reticleRadius * 0.25}
        gapSize={reticleRadius * 0.18}
        depthTest={false}
        renderOrder={10}
      />
      {labelAnchor && <object3D ref={labelAnchor} position={[0, -reticleRadius * 1.7, -radius]} />}
    </group>
  )
}

/**
 * The body's real track across the sky over the loaded period, straight from the ephemeris.
 * Bright where the body is in view, faint where terrain or the horizon hides it.
 */
export function SkyTrack({ path, color, radius }: { path: BodyPath; color: string; radius: number }) {
  const { points, colors } = useMemo(() => {
    const line = skyPathLine(path, radius)
    const c = new Color(color)
    const bright: Vec3 = [c.r, c.g, c.b]
    const faint: Vec3 = [c.r * HIDDEN_TRACK_TINT, c.g * HIDDEN_TRACK_TINT, c.b * HIDDEN_TRACK_TINT]
    return { points: line.points, colors: line.visible.map((v) => (v ? bright : faint)) }
  }, [path, color, radius])
  if (points.length < 2) return null
  return <Line points={points} vertexColors={colors} lineWidth={1.25} transparent opacity={0.9} />
}

/**
 * Overview pointer: an arrow from the lander along the body's true azimuth / elevation.
 * It only gives the direction — the body itself is in the sky, far beyond the terrain patch.
 */
export function DirectionArrow({
  color,
  body,
  status,
  length,
  labelAnchor,
}: {
  color: string
  body: BodyState
  status: BodyStatus
  length: number
  labelAnchor: AnchorRef
}) {
  const visible = status === 'visible'
  const head = length * 0.16
  return (
    <group rotation={aimRotation(body)}>
      <mesh position={[0, 0, -length / 2]} rotation-x={-Math.PI / 2} renderOrder={8}>
        <cylinderGeometry args={[head * 0.09, head * 0.09, length, 12]} />
        <meshBasicMaterial color={color} transparent opacity={visible ? 0.95 : 0.4} depthTest={false} />
      </mesh>
      <mesh position={[0, 0, -length - head / 2]} rotation-x={-Math.PI / 2} renderOrder={9}>
        <coneGeometry args={[head * 0.32, head, 16]} />
        <meshBasicMaterial color={color} transparent opacity={visible ? 1 : 0.45} depthTest={false} />
      </mesh>
      <object3D ref={labelAnchor} position={[0, head * 1.1, -length - head]} />
    </group>
  )
}
