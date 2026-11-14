import { useEffect, useState } from 'react'
import { SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'

// One deliberately shared texture for the whole app, including camera changes and multiple scenes.
// Kept in the asset cache for the app lifetime, rather than allocating a new GPU map every time.
let pending: Promise<Texture | null> | undefined
let cached: Texture | null = null
let failed = false

export function useEarthTexture(): { texture: Texture | null; failed: boolean } {
  const [state, setState] = useState({ texture: cached, failed })
  useEffect(() => {
    let cancelled = false
    pending ??= new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/earth-blue-marble.jpg`)
      .then(texture => {
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 4
        cached = texture
        return texture
      })
      .catch(() => { failed = true; return null })
    void pending.then(texture => { if (!cancelled) setState({ texture, failed }) })
    return () => { cancelled = true }
  }, [])
  return state
}
