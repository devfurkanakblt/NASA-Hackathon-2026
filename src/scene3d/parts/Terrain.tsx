import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, ObjectSpaceNormalMap } from 'three'
import type { MeshPhysicalMaterial, Texture } from 'three'
import { buildPatchSkirt, buildReferenceSphereAroundMesh } from '../terrainGeometry.ts'
import type { TerrainMeshData } from '../terrainGeometry.ts'

// Neutral, untextured display material, not a measured lunar albedo map.
// One shared tone prevents arbitrary colour bands at the different terrain resolutions.
const REGOLITH_COLOR = '#94938f'

const fadeMeasuredNormal: MeshPhysicalMaterial['onBeforeCompile'] = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
    vec3 coarseDisplayNormal = normal;
    #include <normal_fragment_maps>
    #ifdef USE_NORMALMAP_OBJECTSPACE
      vec2 edgeUv = min(vNormalMapUv, vec2(1.0) - vNormalMapUv);
      float edgeDistance = min(edgeUv.x, edgeUv.y);
      float measuredWeight = smoothstep(0.003, 0.025, edgeDistance);
      normal = normalize(mix(coarseDisplayNormal, normal, measuredWeight));
    #endif
  `)
}
const normalProgramKey = () => 'measured-object-normal-edge-v1'

function LunarSurfaceMaterial({ reliefTint = false, doubleSided = false, detailNormal = null }: { reliefTint?: boolean; doubleSided?: boolean; detailNormal?: Texture | null }) {
  const material = useRef<MeshPhysicalMaterial>(null)
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => {
    if (material.current) material.current.needsUpdate = true
    invalidate()
  }, [detailNormal, reliefTint, invalidate])
  return <meshPhysicalMaterial ref={material} color={REGOLITH_COLOR} vertexColors={reliefTint} roughness={1} metalness={0} specularIntensity={0.06} envMapIntensity={0} normalMap={detailNormal} normalMapType={ObjectSpaceNormalMap} onBeforeCompile={fadeMeasuredNormal} customProgramCacheKey={normalProgramKey} side={doubleSided ? DoubleSide : undefined} />
}

/**
 * Low-poly local terrain. Visualisation only — it never decides visibility.
 * Smooth normals come from the actual DEM mesh. The optional inspection aid adds only
 * a small normal-derived contrast; height is never painted as invented surface albedo.
 */
export function Terrain({ data, reliefTint = false, detailNormal = null }: { data: TerrainMeshData; reliefTint?: boolean; detailNormal?: Texture | null }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(data.positions, 3))
    g.setIndex(new BufferAttribute(data.indices.subarray(0, data.seamIndexStart ?? data.indices.length), 1))

    g.computeVertexNormals()
    const normals = g.getAttribute('normal')
    const count = data.positions.length / 3
    const colors = new Float32Array(count * 3)
    const uv = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      // At most 8% contrast, enabled only together with the explicit viewing aid.
      const tone = 0.92 + 0.08 * Math.max(0, Math.min(1, normals.getY(i)))
      colors.fill(tone, i * 3, i * 3 + 3)
      uv[i * 2] = data.positions[i * 3] / (data.halfExtentM * 2) + 0.5
      uv[i * 2 + 1] = -data.positions[i * 3 + 2] / (data.halfExtentM * 2) + 0.5
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.setAttribute('uv', new BufferAttribute(uv, 2))

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
        <LunarSurfaceMaterial reliefTint={reliefTint} detailNormal={detailNormal} />
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
