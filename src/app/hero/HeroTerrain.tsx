import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, LinearFilter, SpriteMaterial, SRGBColorSpace, TextureLoader } from 'three'
import type { IUniform, ShaderMaterial, Texture } from 'three'
import { createTerrainMaterial } from './moonMaterial.ts'
import type { SurfaceUniforms } from './moonMaterial.ts'
import { buildTerrainMesh, decodeHeights, TERRAIN_ORIGIN } from './terrainMesh.ts'
import { SUN_DIRECTION } from './descentPath.ts'
import { loadHeroTerrain } from '../../data/extended.ts'

/** Map radius (m) where the measured terrain hands over to the reference sphere. */
const OUTER_M = 176_000
const FEATHER: [number, number] = [150_000, OUTER_M]
const HOLE_M = 174_000

const base = `${import.meta.env.BASE_URL}assets/hero/terrain/`

interface Patch { geometry: BufferGeometry; material: ShaderMaterial }


function toGeometry({ positions, map, indices }: ReturnType<typeof buildTerrainMesh>) {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('mapXY', new BufferAttribute(map, 2))
  g.setIndex(new BufferAttribute(indices, 1))
  g.computeBoundingSphere()
  return g
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * NASA LOLA heights around Shackleton (see preprocess/hero_terrain.py): a 64 km patch (125 m
 * mesh, 31 m baked light) nested in a 360 km patch (1.4 km mesh) reaching past the horizon.
 * Both sit on the true curved surface; the far patch flattens into the sphere at its rim.
 */
export function HeroTerrain({ mobile, shared, moonUniforms }: { mobile: boolean; shared: SurfaceUniforms; moonUniforms: Record<string, IUniform> }) {
  const { gl, invalidate } = useThree()
  const [patches, setPatches] = useState<Patch[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const owned: { dispose: () => void }[] = []
    const suffix = mobile ? '-mobile' : ''
    const load = async () => {
      // Loaded at run time (not imported): missing terrain data must never break the page.
      const [{ meta, near: nearBin, far: farBin }, nearLight, farLight] = await Promise.all([
        loadHeroTerrain(mobile),
        new TextureLoader().loadAsync(`${base}near${suffix}-light.webp`),
        new TextureLoader().loadAsync(`${base}far${suffix}-light.webp`),
      ])
      for (const t of [nearLight, farLight]) { t.anisotropy = 4; owned.push(t) }
      if (cancelled) return
      const near = meta.crops.near, far = meta.crops.far
      const nearN = mobile ? near['mesh-mobile'] : near['mesh-desktop']
      const farN = mobile ? far['mesh-mobile'] : far['mesh-desktop']
      // Build between tasks so the page keeps scrolling while the meshes are made.
      const nearGeo = toGeometry(buildTerrainMesh({ heights: decodeHeights(nearBin), n: nearN, bounds: near.bounds, skirtM: 600 }))
      await nextTask()
      const farGeo = toGeometry(buildTerrainMesh({ heights: decodeHeights(farBin), n: farN, bounds: far.bounds, feather: FEATHER }))
      await nextTask()
      if (cancelled) { nearGeo.dispose(); farGeo.dispose(); return }
      const cell = (near.bounds[2] - near.bounds[0]) / nearN
      const inner = [near.bounds[0] + cell, near.bounds[1] + cell, near.bounds[2] - cell, near.bounds[3] - cell]
      const result: Patch[] = [
        { geometry: nearGeo, material: createTerrainMaterial(shared, nearLight, near.bounds) },
        { geometry: farGeo, material: createTerrainMaterial(shared, farLight, far.bounds, { outer: OUTER_M, inner }) },
      ]
      result.forEach((patch) => owned.push(patch.geometry, patch.material))
      gl.initTexture(nearLight); gl.initTexture(farLight)
      setPatches(result)
      moonUniforms.uHole.value = HOLE_M
      invalidate()
    }
    load().catch(() => { /* Without terrain the photographed sphere still carries the descent. */ })
    return () => {
      cancelled = true
      moonUniforms.uHole.value = 0
      owned.forEach((item) => item.dispose())
    }
  }, [gl, invalidate, mobile, moonUniforms, shared])

  if (!patches) return null
  return (
    <group position={TERRAIN_ORIGIN}>
      {patches.map((patch, i) => <mesh key={i} geometry={patch.geometry} material={patch.material} />)}
    </group>
  )
}

function glowTexture(): Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255, 226, 170, 0.75)')
  g.addColorStop(0.06, 'rgba(255, 196, 112, 0.5)')
  g.addColorStop(0.22, 'rgba(255, 158, 66, 0.2)')
  g.addColorStop(0.55, 'rgba(214, 118, 40, 0.05)')
  g.addColorStop(1, 'rgba(160, 80, 20, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  return texture
}

/**
 * The Sun sits about 1° above the polar horizon: seen low, its light spreads along the skyline.
 * A wide additive glow at the true solar direction, occluded by the terrain (depth-tested), so
 * ridges stand out against it. It appears with the real-light look.
 */
export function SunGlow({ shared }: { shared: SurfaceUniforms }) {
  const material = useMemo(() => new SpriteMaterial({
    map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0,
  }), [])
  useEffect(() => () => { material.map?.dispose(); material.dispose() }, [material])
  useFrame(() => { material.opacity = shared.uReal.value * 0.9 })
  const position = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(200), [])
  return <sprite material={material} position={position} scale={[360, 64, 1]} renderOrder={1} />
}
