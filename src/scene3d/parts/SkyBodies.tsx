import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Color } from 'three'
import type { Group } from 'three'
import { apparentSphereRadius, rotationInAimFrame } from '../appearance.ts'
import type { QuaternionXyzw } from '../appearance.ts'
import { DEG2RAD } from '../coords.ts'
import { useEarthTexture } from '../earthTexture.ts'
import { STATUS_COLOR } from '../palette.ts'
import { skyPathLine } from '../sky.ts'
import type { BodyPath, BodyState, BodyStatus, Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

const RETICLE_RADIUS_DEG = 1.6
const HIDDEN_TRACK_TINT = 0.32
function aimRotation(body: Pick<BodyState, 'azDeg' | 'elDeg'>): [number, number, number, 'YXZ'] {
  return [body.elDeg * DEG2RAD, -body.azDeg * DEG2RAD, 0, 'YXZ']
}

/** Translation only: sky directions stay astronomical when the overview camera moves. */
export function SkyFollow({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => { group.current?.position.copy(camera.position) })
  return <group ref={group}>{children}</group>
}

// NASA Blue Marble is an archival composite, not invented continents or live weather.
// The Earth-fixed rotation is supplied by the optional orientation data, independently of aim.
const EARTH_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vWorldNormal);
    float incidence = max(dot(n, normalize(uSunDirection)), 0.0);
    vec3 albedo = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uColor;
    gl_FragColor = vec4(albedo * incidence, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function EarthSurface({ color, sunDirection, opacity, through, radius, discRadius, rotation, registered }: {
  color: string; sunDirection: Vec3; opacity: number; through: boolean; radius: number; discRadius: number;
  rotation?: QuaternionXyzw; registered: boolean;
}) {
  const { texture } = useEarthTexture()
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => { invalidate() }, [texture, invalidate])
  const uniforms = useMemo(() => ({
    uMap: { value: null }, uHasMap: { value: 0 }, uColor: { value: new Color(color) },
    uSunDirection: { value: [0, 1, 0] as Vec3 }, uOpacity: { value: 1 },
  }), [color])
  return (
    <mesh position={[0, 0, -radius]} quaternion={rotation} scale={discRadius} renderOrder={through ? 9 : 0}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial
        key={through ? 'through' : 'solid'} vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT}
        uniforms={uniforms} uniforms-uMap-value={texture} uniforms-uHasMap-value={texture && registered ? 1 : 0}
        uniforms-uSunDirection-value={sunDirection} uniforms-uOpacity-value={opacity}
        transparent={through} depthTest={!through}
      />
    </mesh>
  )
}

export interface SkyBodyProps {
  kind: 'sun' | 'earth'
  color: string
  body: BodyState
  status: BodyStatus
  radius: number
  angularDiameterDeg: number
  sunDirection: Vec3
  /** Body-fixed to local scene rotation; absent orientation deliberately hides the map. */
  earthOrientation?: QuaternionXyzw
  showAnnotations?: boolean
  xray: boolean
  labelAnchor?: AnchorRef
}

/** True apparent sizes; the Sun is an airless-sky disc without an atmospheric halo. */
export function SkyBody({ kind, color, body, status, radius, angularDiameterDeg, sunDirection, earthOrientation,
  showAnnotations = true, xray, labelAnchor }: SkyBodyProps) {
  const reticleRadius = radius * Math.tan(RETICLE_RADIUS_DEG * DEG2RAD)
  const reticle = useMemo(() => Array.from({ length: 49 }, (_, i) => {
    const t = i / 48 * Math.PI * 2
    return [Math.cos(t) * reticleRadius, Math.sin(t) * reticleRadius, -radius] as Vec3
  }), [radius, reticleRadius])
  const visible = status === 'visible'
  const through = !visible && xray
  const rotation = useMemo(() => earthOrientation ? rotationInAimFrame(body.azDeg, body.elDeg, earthOrientation) : undefined,
    [body.azDeg, body.elDeg, earthOrientation])
  const opacity = through ? 0.55 : 1
  return (
    <group rotation={aimRotation(body)}>
      {kind === 'sun' ? (
        <mesh position={[0, 0, -radius]} scale={radius * Math.tan(angularDiameterDeg * DEG2RAD / 2)} renderOrder={through ? 9 : 0}>
          <circleGeometry args={[1, 96]} />
          <meshBasicMaterial key={through ? 'through' : 'solid'} color="#fff9ef" toneMapped={false}
            transparent={through} opacity={opacity} depthTest={!through} />
        </mesh>
      ) : (
        <EarthSurface color={color} sunDirection={sunDirection} opacity={opacity} through={through}
          radius={radius} discRadius={apparentSphereRadius(radius, angularDiameterDeg)} rotation={rotation}
          registered={Boolean(earthOrientation)} />
      )}
      {showAnnotations && <Line points={reticle} color={STATUS_COLOR[status] ?? color} lineWidth={1.2}
        dashed={!visible} dashSize={reticleRadius * 0.25} gapSize={reticleRadius * 0.18} depthTest={false} renderOrder={10} />}
      {labelAnchor && <object3D ref={labelAnchor} position={[0, -reticleRadius * 1.7, -radius]} />}
    </group>
  )
}

export function SkyTrack({ path, color, radius }: { path: BodyPath; color: string; radius: number }) {
  const { points, colors } = useMemo(() => {
    const line = skyPathLine(path, radius)
    const c = new Color(color)
    const bright: Vec3 = [c.r, c.g, c.b]
    const faint: Vec3 = [c.r * HIDDEN_TRACK_TINT, c.g * HIDDEN_TRACK_TINT, c.b * HIDDEN_TRACK_TINT]
    return { points: line.points, colors: line.visible.map(v => v ? bright : faint) }
  }, [path, color, radius])
  if (points.length < 2) return null
  return <Line points={points} vertexColors={colors} lineWidth={1.25} transparent opacity={0.9} />
}

/** Annotations only: arrows carry a direction, not an exaggerated physical Sun/Earth size. */
export function DirectionArrow({ color, body, status, length, labelAnchor }: {
  color: string; body: BodyState; status: BodyStatus; length: number; labelAnchor: AnchorRef;
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
