import { useEffect, useState } from 'react'
import { SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'
import { lunarImageryTransform } from './lunarImagery.ts'

type Result = { texture: Texture | null; failed: boolean }
const pending = new Map<string, Promise<Result>>()
const completed = new Map<string, Result>()

/** Local NASA archive images are shared between camera changes; interaction makes no API calls. */
export function useLunarImageryTexture(url: string | undefined, meshSizeM: number, imageSizeM: number): Result {
  const key = url ? `${url}|${meshSizeM}|${imageSizeM}` : undefined
  const [state, setState] = useState<{ key?: string; result: Result }>({ result: { texture: null, failed: false } })
  useEffect(() => {
    if (!key || !url) return
    let cancelled = false
    let promise = pending.get(key)
    if (!promise) {
      promise = new TextureLoader().loadAsync(url).then(texture => {
        const transform = lunarImageryTransform(meshSizeM, imageSizeM)
        texture.colorSpace = SRGBColorSpace
        texture.flipY = true // Image north is at the top, UV v increases northwards.
        texture.repeat.set(transform.repeat, transform.repeat)
        texture.offset.set(transform.offset, transform.offset)
        texture.anisotropy = 8
        const result = { texture, failed: false }
        completed.set(key, result)
        return result
      }).catch(() => {
        pending.delete(key)
        const result = { texture: null, failed: true }
        completed.set(key, result)
        return result
      })
      pending.set(key, promise)
    }
    void promise.then(result => { if (!cancelled) setState({ key, result }) })
    return () => { cancelled = true }
  }, [key, url, meshSizeM, imageSizeM])
  if (!key) return { texture: null, failed: false }
  return completed.get(key) ?? (state.key === key ? state.result : { texture: null, failed: false })
}
