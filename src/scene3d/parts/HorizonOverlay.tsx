import { Line } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import { azElToUnitVector } from '../coords.ts'
import { GEOMETRIC_HORIZON_COLOR, TERRAIN_HORIZON_COLOR } from '../palette.ts'
import { buildHorizonCurtain, elevationCirclePoints, horizonLinePoints } from '../terrainGeometry.ts'
import type { HorizonProfile, Vec3 } from '../types.ts'
import type { AnchorRef } from './Labels.tsx'

/**
 * Terrain silhouette for the lander view, built from the same horizon profile the
 * calculations use. Opaque by default (it hides whatever is behind the terrain);
 * translucent with `xray` so a blocked Sun/Earth can be seen through it.
 */
export function HorizonCurtain({ profile, radius, xray }: { profile: HorizonProfile; radius: number; xray: boolean }) {
  const geometry = useMemo(() => {
    const { positions, indices } = buildHorizonCurtain(profile, radius)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setIndex(new BufferAttribute(indices, 1))
    g.computeBoundingSphere()
    return g
  }, [profile, radius])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial
        key={xray ? 'xray' : 'solid'}
        color="#494843"
        side={DoubleSide}
        transparent={xray}
        opacity={xray ? 0.55 : 1}
        depthWrite={!xray}
      />
    </mesh>
  )
}

/** Terrain horizon (solid) and geometric horizon (dashed) around the observer. */
export function HorizonLines({ profile, radius, geometricHorizonDeg }: { profile: HorizonProfile; radius: number; geometricHorizonDeg: number }) {
  const terrain = useMemo(() => horizonLinePoints(profile, radius), [profile, radius])
  const geometric = useMemo(() => elevationCirclePoints(geometricHorizonDeg, radius), [geometricHorizonDeg, radius])
  return (
    <>
      <Line points={geometric} color={GEOMETRIC_HORIZON_COLOR} lineWidth={1} dashed dashSize={radius * 0.012} gapSize={radius * 0.012} transparent opacity={0.85} depthTest={false} renderOrder={5} />
      <Line points={terrain} color={TERRAIN_HORIZON_COLOR} lineWidth={1.75} depthTest={false} renderOrder={6} />
    </>
  )
}

export interface CompassAnchors {
  north: AnchorRef
  east: AnchorRef
  south: AnchorRef
  west: AnchorRef
}

/** Anchors for the N / E / S / W labels, just below the horizon, for orientation in the lander view. */
export function CompassPoints({ radius, anchors, elDeg = -3 }: { radius: number; anchors: CompassAnchors; elDeg?: number }) {
  const at = (azDeg: number): Vec3 => {
    const [x, y, z] = azElToUnitVector(azDeg, elDeg)
    return [x * radius, y * radius, z * radius]
  }
  return (
    <>
      <object3D ref={anchors.north} position={at(0)} />
      <object3D ref={anchors.east} position={at(90)} />
      <object3D ref={anchors.south} position={at(180)} />
      <object3D ref={anchors.west} position={at(270)} />
    </>
  )
}
