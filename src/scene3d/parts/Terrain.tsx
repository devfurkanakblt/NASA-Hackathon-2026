import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import { buildPatchSkirt, buildReferenceSphereAroundMesh } from '../terrainGeometry.ts'
import type { TerrainMeshData } from '../terrainGeometry.ts'

// Neutral, untextured display material, not a measured lunar albedo map.
// One shared tone prevents arbitrary colour bands at the different terrain resolutions.
const REGOLITH_COLOR = '#94938f'

function LunarSurfaceMaterial({ reliefTint = false, doubleSided = false }: { reliefTint?: boolean; doubleSided?: boolean }) {
  return <meshPhysicalMaterial color={REGOLITH_COLOR} vertexColors={reliefTint} roughness={1} metalness={0} specularIntensity={0.06} envMapIntensity={0} side={doubleSided ? DoubleSide : undefined} />
}

/**
 * Low-poly local terrain. Visualisation only — it never decides visibility.
 * Smooth normals come from the actual DEM mesh. The optional inspection aid adds only
 * a small normal-derived contrast; height is never painted as invented surface albedo.
 */
export function Terrain({ data, reliefTint = false }: { data: TerrainMeshData; reliefTint?: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(data.positions, 3))
    g.setIndex(new BufferAttribute(data.indices.subarray(0, data.seamIndexStart ?? data.indices.length), 1))

    g.computeVertexNormals()
    const normals = g.getAttribute('normal')
    const count = data.positions.length / 3
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      // At most 8% contrast, enabled only together with the explicit viewing aid.
      const tone = 0.92 + 0.08 * Math.max(0, Math.min(1, normals.getY(i)))
      colors.fill(tone, i * 3, i * 3 + 3)
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))

    g.computeBoundingSphere()
    return g
  }, [data])

  useEffect(() => () => geometry.dispose(), [geometry])

  const seam = useMemo(() => {
    if (data.seamIndexStart === undefined || data.seamIndexStart === data.indices.length) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(data.positions, 3))
    g.setIndex(new BufferAttribute(data.indices.subarray(data.seamIndexStart), 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [data])
  useEffect(() => () => seam?.dispose(), [seam])

  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow>
        <LunarSurfaceMaterial reliefTint={reliefTint} />
      </mesh>
      {/* Display-only LOD join; it must not cast invented ridge shadows. */}
      {seam && <mesh geometry={seam} receiveShadow><LunarSurfaceMaterial doubleSided /></mesh>}
    </>
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
    return {
      sphere: toGeometry(buildReferenceSphereAroundMesh(data, siteElevationM, outerRadiusM)),
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
      <mesh geometry={sphere} receiveShadow>
        <LunarSurfaceMaterial />
      </mesh>
      <mesh geometry={skirt} receiveShadow>
        <LunarSurfaceMaterial doubleSided />
      </mesh>
    </>
  )
}
