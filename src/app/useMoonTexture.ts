import { useEffect, useState } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { paintMoonTexture } from './moonTexturePainter.ts'

type MoonTexture = CanvasTexture<HTMLCanvasElement | ImageBitmap>
let cached: MoonTexture | null = null
let pending: Promise<MoonTexture> | undefined

function paintInBatches(): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = 2048; canvas.height = 1024
  const painter = paintMoonTexture(canvas.getContext('2d')!)
  return new Promise(resolve => {
    const batch = () => {
      const start = performance.now()
      do {
        if (painter.next().done) { resolve(canvas); return }
      } while (performance.now() - start < 4)
      setTimeout(batch, 0)
    }
    setTimeout(batch, 0)
  })
}

function paintOffThread(): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./moonTexture.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ImageBitmap>) => { worker.terminate(); resolve(event.data) }
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage(null)
  })
}

/** One app-owned texture: preserve it across scene changes and never paint during React render. */
export function useMoonTexture() {
  const [texture, setTexture] = useState(cached)
  useEffect(() => {
    let cancelled = false
    pending ??= (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined'
      ? paintOffThread().catch(paintInBatches) : paintInBatches()).then(image => {
        cached = new CanvasTexture(image)
        cached.colorSpace = SRGBColorSpace
        return cached
      })
    void pending.then(value => { if (!cancelled) setTexture(value) })
    return () => { cancelled = true }
  }, [])
  return texture
}
