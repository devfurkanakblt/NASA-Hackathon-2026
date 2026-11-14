import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
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
