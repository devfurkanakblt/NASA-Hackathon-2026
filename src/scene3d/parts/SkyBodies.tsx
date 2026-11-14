import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import { DEG2RAD } from '../coords.ts'
import { STATUS_COLOR } from '../palette.ts'
import type { BodyState, BodyStatus, Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

/** Angular radius of the ring that marks a body in the lander view. */
const RETICLE_RADIUS_DEG = 1.6
const RETICLE_SEGMENTS = 48

/**
 * Euler rotation (order YXZ) that turns the local −Z axis towards azimuth / elevation while
 * keeping local +Y "up". Everything about a body is built once along −Z and then only rotated,
 * so stepping through time never rebuilds geometry or materials.
 */
function aimRotation(body: BodyState): [number, number, number, 'YXZ'] {
  return [body.elDeg * DEG2RAD, -body.azDeg * DEG2RAD, 0, 'YXZ']
}

export interface SkyBodyProps {
  color: string
  body: BodyState
  status: BodyStatus
  /** Where the body's text label is pinned. */
  labelAnchor: AnchorRef
}

/**
 * Overview marker: an enlarged dot on the body's true azimuth / elevation, joined to the
 * lander by a direction line. Always drawn on top of the terrain — it is a pointer, not a disc.
 */
export function OverviewMarker({ color, body, status, labelAnchor, radius, markerRadius }: SkyBodyProps & { radius: number; markerRadius: number }) {
  const linePoints = useMemo<Vec3[]>(
    () => [
      [0, 0, 0],
      [0, 0, -radius],
    ],
    [radius],
  )
  const visible = status === 'visible'

  return (
    <group rotation={aimRotation(body)}>
      <Line
        points={linePoints}
        color={color}
        lineWidth={visible ? 2 : 1.25}
        dashed={!visible}
        dashSize={radius * 0.03}
        gapSize={radius * 0.02}
        transparent
        opacity={visible ? 0.95 : 0.55}
        depthTest={false}
        renderOrder={8}
      />
      <mesh position={[0, 0, -radius]} renderOrder={9}>
        <sphereGeometry args={[markerRadius, 24, 16]} />
        <meshBasicMaterial color={color} transparent opacity={visible ? 1 : 0.35} depthTest={false} />
      </mesh>
      <object3D ref={labelAnchor} position={[0, markerRadius * 2.4, -radius]} />
    </group>
  )
}

/**
 * Lander-view body: the disc at its true angular size, hidden by the terrain silhouette when
 * blocked, plus a ring and label that always show where it is. With `xray` the disc is drawn
 * through the terrain so "above the geometric horizon, behind the mountain" can be seen.
 */
export function LanderViewBody({
  color,
  body,
  status,
  labelAnchor,
  radius,
  angularDiameterDeg,
  xray,
}: SkyBodyProps & { radius: number; angularDiameterDeg: number; xray: boolean }) {
  const reticleRadius = radius * Math.tan(RETICLE_RADIUS_DEG * DEG2RAD)
  const reticle = useMemo(() => {
    const points: Vec3[] = []
    for (let i = 0; i <= RETICLE_SEGMENTS; i++) {
      const t = (i / RETICLE_SEGMENTS) * Math.PI * 2
      points.push([Math.cos(t) * reticleRadius, Math.sin(t) * reticleRadius, -radius])
    }
    return points
  }, [radius, reticleRadius])

  const visible = status === 'visible'
  const hiddenDisc = !visible && xray

  return (
    <group rotation={aimRotation(body)}>
      <mesh position={[0, 0, -radius]} renderOrder={hiddenDisc ? 9 : 0}>
        <sphereGeometry args={[radius * Math.tan((angularDiameterDeg / 2) * DEG2RAD), 32, 16]} />
        <meshBasicMaterial
          key={hiddenDisc ? 'xray' : 'solid'}
          color={color}
          transparent={hiddenDisc}
          opacity={hiddenDisc ? 0.6 : 1}
          depthTest={!hiddenDisc}
        />
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
      <object3D ref={labelAnchor} position={[0, -reticleRadius * 1.7, -radius]} />
    </group>
  )
}
