import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { RefObject } from 'react'

/** Opt-in development harness only. Idle demand rendering is not reported as a low frame rate. */
export function Diagnostics({ output }: { output: RefObject<HTMLOutputElement | null> }) {
  const samples = useRef<number[]>([])
  const previous = useRef(0)
  const updated = useRef(0)
  useFrame(({ gl }) => {
    const now = performance.now()
    const elapsed = now - previous.current
    previous.current = now
    if (elapsed > 0 && elapsed < 200) {
      samples.current.push(elapsed)
      if (samples.current.length > 60) samples.current.shift()
    } else samples.current.length = 0
    if (output.current && now - updated.current > 500) {
      updated.current = now
      const n = samples.current.length
      const fps = n ? (1000 * n / samples.current.reduce((a,b) => a+b, 0)).toFixed(1) : 'idle'
      output.current.textContent = `Render FPS: ${fps} · draw calls: ${gl.info.render.calls} · geometries: ${gl.info.memory.geometries} · textures: ${gl.info.memory.textures}`
    }
  })
  return null
}
