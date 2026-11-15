import { useEffect, useState } from 'react'
import { NoColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'

type Result = { texture: Texture | null; failed: boolean }
const cache = new Map<string, Promise<Result>>()
const completed = new Map<string, Result>()

/** One bounded cached GPU texture per visited, content-addressed NASA display asset. */
export function useTerrainNormalTexture(url: string | undefined, footprintRatio = 1): Result {
  const key = url ? `${url}|${footprintRatio}` : undefined
  const [state, setState] = useState<{ url?: string; result: Result }>({ result: { texture: null, failed: false } })
  useEffect(() => {
    if (!url || !key) return
    let cancelled = false
    let pending = cache.get(key)
    if (!pending) {
      pending = new TextureLoader().loadAsync(url).then(texture => {
        texture.colorSpace = NoColorSpace
        texture.flipY = true // PNG north at top, UV north increases upwards.
        texture.repeat.set(footprintRatio, footprintRatio)
        texture.offset.set((1 - footprintRatio) / 2, (1 - footprintRatio) / 2)
        texture.anisotropy = 4
        const result = { texture, failed: false }
        completed.set(key, result)
        return result
      }).catch(() => {
        cache.delete(key) // Revisiting a site can recover after a temporary local asset failure.
        const result = { texture: null, failed: true }
        completed.set(key, result)
        return result
      })
      cache.set(key, pending)
    }
    void pending.then(result => { if (!cancelled) setState({ url: key, result }) })
    return () => { cancelled = true }
  }, [url, key, footprintRatio])
  if (!key) return { texture: null, failed: false }
  return completed.get(key) ?? (state.url === key ? state.result : { texture: null, failed: false })
}
