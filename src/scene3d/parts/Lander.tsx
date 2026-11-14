import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Group } from 'three'
import { OBSERVER_HEIGHT_M, panelSize } from '../coords.ts'
import { NORTH_COLOR } from '../palette.ts'
import type { Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

const UP = new Vector3(0, 1, 0)

/** Camera distance (m) at which the lander is drawn at true size; beyond it, it is enlarged. */
const TRUE_SCALE_DISTANCE_M = 60

const PAD_Y = 0.03
const BODY_BOTTOM_Y = 0.65
const BODY_HEIGHT = 0.7
const BODY_TOP_Y = BODY_BOTTOM_Y + BODY_HEIGHT
const LEG_SIGNS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const LEGS: { from: Vec3; to: Vec3 }[] = LEG_SIGNS.map(([sx, sz]) => ({
  from: [sx * 0.5, BODY_BOTTOM_Y + 0.05, sz * 0.5],
  to: [sx * 1.0, PAD_Y * 2, sz * 1.0],
}))
const MAST: { from: Vec3; to: Vec3 } = { from: [0, BODY_TOP_Y, 0], to: [0, OBSERVER_HEIGHT_M, 0] }
const NORTH_SHAFT: { from: Vec3; to: Vec3 } = { from: [0, 0.2, -1.7], to: [0, 0.2, -3.3] }

/** Orientation whose local +Z is `normal`, keeping the panel's long edge horizontal. */
function quaternionForNormal([x, y, z]: Vec3): Quaternion {
  const n = new Vector3(x, y, z).normalize()
  const right = new Vector3().crossVectors(UP, n)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const up = new Vector3().crossVectors(n, right)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, n))
}

function Strut({ from, to, radius, color }: { from: Vec3; to: Vec3; radius: number; color: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(UP, dir.normalize()),
      length: len,
    }
  }, [from, to])
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} />
    </mesh>
  )
}

export interface LanderProps {
  /** Panel normal in the scene frame. */
  panelNormal: Vec3
  /** Panel is producing power (Sun visible and on the front side). */
  panelLit: boolean
  panelAreaM2: number
  /** Where the "N" label of the north arrow is pinned. */
  northLabelAnchor: AnchorRef
}

/**
 * Representative lander with its solar panel and a north arrow, standing on the site.
 * It is a few metres across on a terrain patch kilometres wide, so in the overview it is
 * enlarged with camera distance to stay readable (the scene caption says so).
 */
export function Lander({ panelNormal, panelLit, panelAreaM2, northLabelAnchor }: LanderProps) {
  const group = useRef<Group>(null)
  const panelQuaternion = useMemo(() => quaternionForNormal(panelNormal), [panelNormal])
  const { widthM, heightM } = panelSize(panelAreaM2)

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const scale = Math.max(1, camera.position.length() / TRUE_SCALE_DISTANCE_M)
    if (g.scale.x !== scale) g.scale.setScalar(scale)
  })

  return (
    <group ref={group}>
      {LEGS.map((leg, i) => (
        <group key={i}>
          <Strut from={leg.from} to={leg.to} radius={0.04} color="#b9bcc4" />
          <mesh position={[leg.to[0], PAD_Y, leg.to[2]]}>
            <cylinderGeometry args={[0.2, 0.2, PAD_Y * 2, 12]} />
            <meshStandardMaterial color="#9a9da6" roughness={0.8} metalness={0.3} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, BODY_BOTTOM_Y + BODY_HEIGHT / 2, 0]} rotation-y={Math.PI / 8}>
        <cylinderGeometry args={[0.75, 0.75, BODY_HEIGHT, 8]} />
        <meshStandardMaterial color="#c9a23a" roughness={0.55} metalness={0.35} />
      </mesh>

      <Strut from={MAST.from} to={MAST.to} radius={0.04} color="#b9bcc4" />

      <mesh position={[0, OBSERVER_HEIGHT_M, 0]} quaternion={panelQuaternion}>
        <boxGeometry args={[widthM, heightM, 0.04]} />
        <meshStandardMaterial
          color={panelLit ? '#2f6fed' : '#1c2738'}
          emissive="#000000"
          emissiveIntensity={0}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>

      {/* North arrow: drawn on top of the terrain so a slope never hides it. */}
      <group renderOrder={7}>
        <mesh position={[0, NORTH_SHAFT.from[1], (NORTH_SHAFT.from[2] + NORTH_SHAFT.to[2]) / 2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.06, NORTH_SHAFT.from[2] - NORTH_SHAFT.to[2], 8]} />
          <meshBasicMaterial color={NORTH_COLOR} depthTest={false} />
        </mesh>
        <mesh position={[0, NORTH_SHAFT.to[1], NORTH_SHAFT.to[2] - 0.3]} rotation-x={-Math.PI / 2}>
          <coneGeometry args={[0.2, 0.6, 12]} />
          <meshBasicMaterial color={NORTH_COLOR} depthTest={false} />
        </mesh>
      </group>
      <object3D ref={northLabelAnchor} position={[0, 0.2, NORTH_SHAFT.to[2] - 1.1]} />
    </group>
  )
}
