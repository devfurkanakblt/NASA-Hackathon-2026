import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import type { LunarImageryDetail, MapDoc } from '../data/contract.ts'
import { useLunarImageryTexture } from './lunarImageryTexture.ts'
import { moonPosition } from '../app/moonFlight.ts'

function Area({ map, photo }: { map: MapDoc; photo?: LunarImageryDetail }) {
  const { texture } = useLunarImageryTexture(photo?.textureUrl, photo?.manifest.sizeM ?? 10000, photo?.manifest.sizeM ?? 10000)
  const geometry = useMemo(() => {
    const vertices = new Float32Array(map.latDeg.length * 3), uv = new Float32Array(map.latDeg.length * 2)
    map.latDeg.forEach((lat, i) => {
      moonPosition({ latDeg: lat, lonDeg: map.lonDeg[i] }).multiplyScalar(1.0006).toArray(vertices, i * 3)
      uv[i * 2] = (-map.grid.halfSizeM + (i % map.grid.nx) * map.grid.spacingM) / (photo?.manifest.sizeM ?? 10000) + .5
      uv[i * 2 + 1] = (-map.grid.halfSizeM + Math.floor(i / map.grid.nx) * map.grid.spacingM) / (photo?.manifest.sizeM ?? 10000) + .5
    })
    const indices: number[] = []
    for (let r = 0; r < map.grid.ny - 1; r++) for (let c = 0; c < map.grid.nx - 1; c++) {
      const a = r * map.grid.nx + c, b = a + 1, d = a + map.grid.nx, e = d + 1
      indices.push(a, b, d, b, e, d)
    }
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(vertices, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2)); g.setIndex(indices)
    return g
  }, [map, photo])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} renderOrder={texture ? 20 : 5}><meshBasicMaterial key={String(Boolean(texture))} map={texture} color={texture ? '#c8ffed' : '#55e0b1'} transparent opacity={texture ? .92 : .22} depthTest={false} depthWrite={false} toneMapped={false} /></mesh>
}

/** Exact geographic extent of bundled grids. Focused areas use their registered local photograph. */
export function ComputedAreas({ maps, images, focusId }: { maps: MapDoc[]; images?: Record<string, LunarImageryDetail>; focusId?: string }) {
  return <>{maps.map(map => <Area key={map.siteId} map={map} photo={map.siteId === focusId ? images?.[map.siteId] : undefined} />)}</>
}
