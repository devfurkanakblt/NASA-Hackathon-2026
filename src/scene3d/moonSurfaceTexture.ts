import { useEffect, useState } from 'react'
import { ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'

type Result = { texture: Texture | null; failed: boolean }
let cached: Texture | null = null
let failed = false
let pending: Promise<Texture | null> | undefined

/** A real local LROC WAC global photograph; no painted or procedural fallback. */
export function useMoonSurfaceTexture(): Result {
  const [state, setState] = useState<Result>({ texture: cached, failed })
  useEffect(() => {
    let cancelled = false
    pending ??= new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/moon-lroc-wac.jpg`)
      .then(texture => {
        texture.colorSpace = SRGBColorSpace
        texture.flipY = true // Archive row 0 is north; Three sphere v increases northwards.
        texture.wrapS = RepeatWrapping
        texture.wrapT = ClampToEdgeWrapping
        texture.anisotropy = 8
        cached = texture
        return texture
      }).catch(() => { failed = true; return null })
    void pending.then(texture => { if (!cancelled) setState({ texture, failed }) })
    return () => { cancelled = true }
  }, [])
  return state
}
