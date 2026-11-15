import { paintMoonTexture } from './moonTexturePainter.ts'

const scope = self as unknown as { onmessage: () => void; postMessage: (value: ImageBitmap, transfer: Transferable[]) => void }
scope.onmessage = () => {
  const canvas = new OffscreenCanvas(2048, 1024)
  const ctx = canvas.getContext('2d')!
  for (const _ of paintMoonTexture(ctx)) { /* Work happens off the UI thread. */ }
  const bitmap = canvas.transferToImageBitmap()
  scope.postMessage(bitmap, [bitmap])
}
