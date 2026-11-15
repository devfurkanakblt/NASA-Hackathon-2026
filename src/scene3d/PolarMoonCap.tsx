import { useEffect, useMemo, useState } from 'react'
import { BufferAttribute, SphereGeometry, SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'
import metadata from '../../public/assets/moon-south-polar.json'

/** South stereographic coordinates, matching the LROC Moon radius and +east longitudes. */
export function polarUv(x: number, y: number, z: number, bounds: number[]) {
  const east = -2 * 1737400 * z / (1 - y)
  const north = 2 * 1737400 * x / (1 - y)
  return [(east - bounds[0]) / (bounds[2] - bounds[0]), (north - bounds[1]) / (bounds[3] - bounds[1])]
}
let pending: Promise<Texture> | undefined

/** A separately projected real polar photograph avoids magnifying equirectangular pole pixels. */
export function PolarMoonCap() {
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    let cancelled = false
    pending ??= new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/moon-south-polar.jpg`).then(t => { t.colorSpace = SRGBColorSpace; t.anisotropy = 8; return t })
    void pending.then(t => { if (!cancelled) setTexture(t) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const geometry = useMemo(() => {
    const g = new SphereGeometry(1, 256, 64, 0, Math.PI * 2, 174.3 * Math.PI / 180, 5.7 * Math.PI / 180)
    const positions = g.getAttribute('position'), uv = g.getAttribute('uv')
    const colors = new Float32Array(positions.count * 4)
    for (let i = 0; i < positions.count; i++) {
      const [u, v] = polarUv(positions.getX(i), positions.getY(i), positions.getZ(i), metadata.bounds)
      uv.setXY(i, u, v)
      const latitude = Math.asin(Math.max(-1, Math.min(1, positions.getY(i)))) * 180 / Math.PI
      const t = Math.max(0, Math.min(1, (-latitude - 84.3) / .7))
      colors.set([1, 1, 1, t * t * (3 - 2 * t)], i * 4)
    }
    g.setAttribute('color', new BufferAttribute(colors, 4))
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!texture) return null
  return <mesh geometry={geometry} scale={1.0002}><meshBasicMaterial map={texture} vertexColors transparent depthWrite={false} toneMapped={false} /></mesh>
}
