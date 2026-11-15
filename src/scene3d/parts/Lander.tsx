import { useMemo } from 'react'
import { CanvasTexture, DoubleSide, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import type { Texture } from 'three'
import { OBSERVER_HEIGHT_M, panelSize } from '../coords.ts'
import { NORTH_COLOR } from '../palette.ts'
import type { Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

const UP = new Vector3(0, 1, 0)

/** Furthest extent of the model from its centre (north arrow tip), in model metres. */
export const LANDER_MODEL_RADIUS_M = 4

// Representative modern robotic lander (not a specific spacecraft), in model metres.
const PAD_Y = 0.04
const BODY_BOTTOM_Y = 0.7
const BODY_HEIGHT = 0.62
const BODY_TOP_Y = BODY_BOTTOM_Y + BODY_HEIGHT
const BODY_RADIUS = 0.72
const DECK_HEIGHT = 0.05
const DECK_TOP_Y = BODY_TOP_Y + DECK_HEIGHT
const OCTAGON = Math.PI / 8
const DIAGONALS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const s = Math.SQRT1_2
/** Main strut from the upper body to the footpad, and a support strut to its knee. */
const LEGS = DIAGONALS.map(([sx, sz]) => {
  const hip: Vec3 = [sx * s * 0.66, BODY_TOP_Y - 0.12, sz * s * 0.66]
  const foot: Vec3 = [sx * s * 1.5, PAD_Y * 2, sz * s * 1.5]
  const knee: Vec3 = [hip[0] + (foot[0] - hip[0]) * 0.62, hip[1] + (foot[1] - hip[1]) * 0.62, hip[2] + (foot[2] - hip[2]) * 0.62]
  const brace: Vec3 = [sx * s * 0.5, BODY_BOTTOM_Y + 0.04, sz * s * 0.5]
  return { hip, foot, knee, brace }
})
const MAST: { from: Vec3; to: Vec3 } = { from: [0, DECK_TOP_Y, 0], to: [0, OBSERVER_HEIGHT_M, 0] }
const NORTH_SHAFT: { from: Vec3; to: Vec3 } = { from: [0, 0.2, -1.7], to: [0, 0.2, -3.3] }

const FOIL = '#c99a2e'
const FOIL_DARK = '#8f6a1c'
const SILVER = '#c3c7cf'
const STRUT = '#a9adb6'
const DARK_METAL = '#3a3d44'

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
      <cylinderGeometry args={[radius, radius, length, 10]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.7} />
    </mesh>
  )
}

let cellTexture: Texture | null = null
/** Solar cells drawn once: dark blue cells separated by thin silver bus lines. */
function solarCellTexture(): Texture {
  if (cellTexture) return cellTexture
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 160
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#d7dbe2'
    g.fillRect(0, 0, canvas.width, canvas.height)
    const cols = 8, rows = 5, gap = 3
    const w = (canvas.width - gap) / cols, h = (canvas.height - gap) / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = gap + c * w, y = gap + r * h
        const grad = g.createLinearGradient(x, y, x + w, y + h)
        grad.addColorStop(0, '#1d3f8f')
        grad.addColorStop(1, '#13285c')
        g.fillStyle = grad
        g.fillRect(x, y, w - gap, h - gap)
        g.strokeStyle = 'rgba(190, 205, 235, 0.25)'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x + (w - gap) / 2, y)
        g.lineTo(x + (w - gap) / 2, y + h - gap)
        g.stroke()
      }
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  cellTexture = texture
  return texture
}

export interface LanderProps {
  /** Panel normal in the scene frame. */
  panelNormal: Vec3
  /** Panel is producing power (Sun visible and on the front side). */
  panelLit: boolean
  panelAreaM2: number
  /** Where the "N" label of the north arrow is pinned. */
  northLabelAnchor: AnchorRef
  /** Fixed enlargement of the few-metre model so it reads on a kilometre-wide patch. */
  displayScale: number
}

/**
 * Representative lander with its solar panel and a north arrow, standing on the site.
 * It is a few metres across on a terrain patch kilometres wide, so it is drawn enlarged by a
 * fixed factor (the scene caption says so). The factor never changes with camera distance:
 * the lander keeps one size in the scene and grows on screen as the camera approaches.
 * Only the panel carries data: its direction (`panelNormal`), area and lit state.
 */
export function Lander({ panelNormal, panelLit, panelAreaM2, northLabelAnchor, displayScale }: LanderProps) {
  const panelQuaternion = useMemo(() => quaternionForNormal(panelNormal), [panelNormal])
  const { widthM, heightM } = panelSize(panelAreaM2)
  const cells = useMemo(() => solarCellTexture(), [])

  return (
    <group scale={displayScale}>
      {/* Landing legs: main strut to a saucer footpad, support strut from the lower body. */}
      {LEGS.map((leg, i) => (
        <group key={i}>
          <Strut from={leg.hip} to={leg.foot} radius={0.045} color={STRUT} />
          <Strut from={leg.brace} to={leg.knee} radius={0.03} color={STRUT} />
          <mesh position={[leg.foot[0], PAD_Y, leg.foot[2]]}>
            <cylinderGeometry args={[0.2, 0.26, PAD_Y * 2, 20]} />
            <meshStandardMaterial color={SILVER} roughness={0.5} metalness={0.6} />
          </mesh>
          <mesh position={leg.hip}>
            <sphereGeometry args={[0.06, 12, 8]} />
            <meshStandardMaterial color={DARK_METAL} roughness={0.5} metalness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Engine bell under the body. */}
      <mesh position={[0, BODY_BOTTOM_Y - 0.2, 0]}>
        <cylinderGeometry args={[0.16, 0.3, 0.4, 24, 1, true]} />
        <meshStandardMaterial color={DARK_METAL} roughness={0.35} metalness={0.85} side={DoubleSide} />
      </mesh>
      <mesh position={[0, BODY_BOTTOM_Y - 0.01, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.02, 24]} />
        <meshStandardMaterial color={DARK_METAL} roughness={0.6} metalness={0.5} />
      </mesh>

      {/* Octagonal body in gold insulation foil, with a darker seam band. */}
      <mesh position={[0, BODY_BOTTOM_Y + BODY_HEIGHT / 2, 0]} rotation-y={OCTAGON}>
        <cylinderGeometry args={[BODY_RADIUS, BODY_RADIUS * 0.94, BODY_HEIGHT, 8]} />
        <meshStandardMaterial color={FOIL} roughness={0.32} metalness={0.85} flatShading />
      </mesh>
      <mesh position={[0, BODY_BOTTOM_Y + BODY_HEIGHT * 0.42, 0]} rotation-y={OCTAGON}>
        <cylinderGeometry args={[BODY_RADIUS * 1.005, BODY_RADIUS * 1.005, 0.035, 8]} />
        <meshStandardMaterial color={FOIL_DARK} roughness={0.5} metalness={0.7} flatShading />
      </mesh>

      {/* Thruster blocks on the four diagonals. */}
      {DIAGONALS.map(([sx, sz], i) => (
        <mesh key={i} position={[sx * s * BODY_RADIUS * 0.97, BODY_BOTTOM_Y + BODY_HEIGHT * 0.75, sz * s * BODY_RADIUS * 0.97]}
          rotation-y={Math.atan2(sx, sz)}>
          <boxGeometry args={[0.14, 0.12, 0.1]} />
          <meshStandardMaterial color={DARK_METAL} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* Top deck with two propellant tanks and a dish antenna. */}
      <mesh position={[0, BODY_TOP_Y + DECK_HEIGHT / 2, 0]} rotation-y={OCTAGON}>
        <cylinderGeometry args={[BODY_RADIUS * 1.04, BODY_RADIUS * 1.04, DECK_HEIGHT, 8]} />
        <meshStandardMaterial color={SILVER} roughness={0.4} metalness={0.75} flatShading />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.34, DECK_TOP_Y + 0.13, 0.18]}>
          <sphereGeometry args={[0.16, 20, 14]} />
          <meshStandardMaterial color="#e3e5ea" roughness={0.3} metalness={0.6} />
        </mesh>
      ))}
      <group position={[0.38, DECK_TOP_Y, -0.36]}>
        <Strut from={[0, 0, 0]} to={[0, 0.32, 0]} radius={0.025} color={STRUT} />
        <mesh position={[0, 0.36, 0]} rotation={[-Math.PI / 3, 0, 0]}>
          <sphereGeometry args={[0.26, 24, 8, 0, Math.PI * 2, 0, 0.55]} />
          <meshStandardMaterial color="#eef0f3" roughness={0.35} metalness={0.3} side={DoubleSide} />
        </mesh>
      </group>

      {/* Mast up to the eye height used by the horizon calculation. */}
      <Strut from={MAST.from} to={MAST.to} radius={0.035} color={STRUT} />

      {/* Solar panel: framed, cells on the front, pointing along the panel normal of the model. */}
      <group position={[0, OBSERVER_HEIGHT_M, 0]} quaternion={panelQuaternion}>
        <mesh position={[0, 0, -0.015]}>
          <boxGeometry args={[widthM + 0.06, heightM + 0.06, 0.03]} />
          <meshStandardMaterial color={SILVER} roughness={0.45} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[widthM, heightM]} />
          <meshStandardMaterial map={cells} color={panelLit ? '#ffffff' : '#56607a'}
            emissive={panelLit ? '#163a8a' : '#000000'} emissiveIntensity={panelLit ? 0.35 : 0}
            roughness={0.25} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0, -0.032]} rotation-y={Math.PI}>
          <planeGeometry args={[widthM, heightM]} />
          <meshStandardMaterial color="#f2f3f5" roughness={0.8} metalness={0.05} />
        </mesh>
      </group>

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
