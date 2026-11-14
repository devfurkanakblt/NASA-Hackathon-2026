import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import { buildPatchSkirt, buildReferenceSphereRing } from '../terrainGeometry.ts'
import type { TerrainMeshData } from '../terrainGeometry.ts'

/** Brightness of the lowest ground relative to the highest (elevation tint). */
const LOW_GROUND_TINT = 0.5

/**
 * Low-poly local terrain. Visualisation only — it never decides visibility.
 * Vertices are tinted by elevation (low = darker) so the relief stays readable
 * when the Sun is down and only the fill light is left.
 */
export function Terrain({ data }: { data: TerrainMeshData }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(data.positions, 3))
    g.setIndex(new BufferAttribute(data.indices, 1))

    const count = data.positions.length / 3
    const colors = new Float32Array(count * 3)
    const range = Math.max(1e-6, data.maxY - data.minY)
    for (let i = 0; i < count; i++) {
      const t = (data.positions[i * 3 + 1] - data.minY) / range
      colors.fill(LOW_GROUND_TINT + (1 - LOW_GROUND_TINT) * t, i * 3, i * 3 + 3)
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))

    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [data])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#a8a39b" vertexColors roughness={1} metalness={0} />
    </mesh>
  )
}

/**
 * Smooth lunar reference sphere beyond the terrain patch (overview only), and the cut faces
 * that join the patch to it. The sphere gives the scene the real curvature and limb of the Moon;
 * it carries no relief and is drawn plain on purpose.
 */
export function ReferenceSphere({ data, siteElevationM, outerRadiusM }: { data: TerrainMeshData; siteElevationM: number; outerRadiusM: number }) {
  const { sphere, skirt } = useMemo(() => {
    const toGeometry = ({ positions, indices }: { positions: Float32Array; indices: Uint32Array }) => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(positions, 3))
      g.setIndex(new BufferAttribute(indices, 1))
      g.computeVertexNormals()
      g.computeBoundingSphere()
      return g
    }
    // The hole in the sphere follows the outermost mesh vertices, so the cut faces meet it exactly.
    const edge = Math.abs(data.positions[0])
    return {
      sphere: toGeometry(buildReferenceSphereRing(edge, siteElevationM, outerRadiusM)),
      skirt: toGeometry(buildPatchSkirt(data, siteElevationM)),
    }
  }, [data, siteElevationM, outerRadiusM])

  useEffect(
    () => () => {
      sphere.dispose()
      skirt.dispose()
    },
    [sphere, skirt],
  )

  return (
    <>
      <mesh geometry={sphere}>
        <meshStandardMaterial color="#5d5b59" roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={skirt}>
        <meshBasicMaterial color="#1f1f22" side={DoubleSide} />
      </mesh>
    </>
  )
}
