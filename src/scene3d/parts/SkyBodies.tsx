import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Color } from 'three'
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

// Earth is drawn as a plain sphere lit from the Sun's direction, which gives its real phase.
const EARTH_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const EARTH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  void main() {
    float lit = smoothstep(-0.04, 0.10, dot(normalize(vWorldNormal), uSunDirection));
    gl_FragColor = vec4(uColor * (0.07 + 0.93 * lit), uOpacity);
    #include <colorspace_fragment>
  }
`

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

  const visible = status === 'visible'
  const through = !visible && xray
  const opacity = through ? 0.6 : 1

  return (
    <group rotation={aimRotation(body)}>
      <mesh position={[0, 0, -radius]} renderOrder={through ? 9 : 0}>
        <sphereGeometry args={[radius * Math.tan((angularDiameterDeg / 2) * DEG2RAD), 48, 24]} />
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
  const shaft = useMemo<Vec3[]>(
    () => [
      [0, 0, 0],
      [0, 0, -length],
    ],
    [length],
  )
  const visible = status === 'visible'
  const head = length * 0.16
  return (
    <group rotation={aimRotation(body)}>
      <Line
        points={shaft}
        color={color}
        lineWidth={visible ? 2.5 : 1.5}
        dashed={!visible}
        dashSize={length * 0.06}
        gapSize={length * 0.04}
        transparent
        opacity={visible ? 0.95 : 0.6}
        depthTest={false}
        renderOrder={8}
      />
      <mesh position={[0, 0, -length - head / 2]} rotation-x={-Math.PI / 2} renderOrder={9}>
        <coneGeometry args={[head * 0.32, head, 16]} />
        <meshBasicMaterial color={color} transparent opacity={visible ? 1 : 0.5} depthTest={false} />
      </mesh>
      <object3D ref={labelAnchor} position={[0, head * 1.1, -length - head]} />
    </group>
  )
}
