import { useEffect, useMemo, useState } from 'react'
import { BufferAttribute, SphereGeometry, SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'
import metadata from '../../public/assets/moon-south-polar.json'
import context from '../../public/assets/moon-south-context.json'

/** South stereographic coordinates, matching the LROC Moon radius and +east longitudes. */
export function polarUv(x: number, y: number, z: number, bounds: number[]) {
  const east = -2 * 1737400 * z / (1 - y)
  const north = 2 * 1737400 * x / (1 - y)
  return [(east - bounds[0]) / (bounds[2] - bounds[0]), (north - bounds[1]) / (bounds[3] - bounds[1])]
}
const pending = new Map<string, Promise<Texture>>()

function PolarPhoto({ file, bounds, outerLatitude, solidLatitude, scale }: {
  file: string; bounds: number[]; outerLatitude: number; solidLatitude: number; scale: number
}) {
  const [texture, setTexture] = useState<Texture | null>(null)
  useEffect(() => {
    let cancelled = false
    let promise = pending.get(file)
    if (!promise) {
      promise = new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/${file}`).then(t => { t.colorSpace = SRGBColorSpace; t.anisotropy = 8; return t })
      pending.set(file, promise)
    }
    void promise.then(t => { if (!cancelled) setTexture(t) }).catch(() => { pending.delete(file) })
    return () => { cancelled = true }
  }, [file])
  const geometry = useMemo(() => {
    const g = new SphereGeometry(1, 384, 128, 0, Math.PI * 2, (90 + outerLatitude) * Math.PI / 180, (90 - outerLatitude) * Math.PI / 180)
    const positions = g.getAttribute('position'), uv = g.getAttribute('uv')
    const colors = new Float32Array(positions.count * 4)
    for (let i = 0; i < positions.count; i++) {
      const [u, v] = polarUv(positions.getX(i), positions.getY(i), positions.getZ(i), bounds)
      uv.setXY(i, u, v)
      const latitude = Math.asin(Math.max(-1, Math.min(1, positions.getY(i)))) * 180 / Math.PI
      const t = Math.max(0, Math.min(1, (-latitude - outerLatitude) / (solidLatitude - outerLatitude)))
      colors.set([1, 1, 1, t * t * (3 - 2 * t)], i * 4)
    }
    g.setAttribute('color', new BufferAttribute(colors, 4))
    return g
  }, [bounds, outerLatitude, solidLatitude])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} scale={scale}><meshBasicMaterial key={`${file}:${Boolean(texture)}`} map={texture} color={texture ? '#ffffff' : '#555555'} vertexColors transparent depthWrite={false} toneMapped={false} /></mesh>
}

/** Correctly projected context covers the whole southern polar region, not only the NAC centre. */
export function PolarMoonCap() {
  return <>
    <PolarPhoto file={context.file} bounds={context.bounds} outerLatitude={60} solidLatitude={62} scale={1.0001} />
    <PolarPhoto file={metadata.file} bounds={metadata.bounds} outerLatitude={84.3} solidLatitude={85} scale={1.0002} />
  </>
}
