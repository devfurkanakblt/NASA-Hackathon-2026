import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { RefObject } from 'react'
import { Vector3 } from 'three'
import type { Object3D } from 'three'

const EDGE_MARGIN_PX = 4

export type AnchorRef = RefObject<Object3D | null>

export interface LabelBinding {
  /** Empty object placed in the scene where the label belongs; `null` hides the label. */
  anchor: AnchorRef
  /** DOM element rendered by the surrounding (non-3D) React tree. */
  element: RefObject<HTMLElement | null>
}

/**
 * Keeps plain DOM labels glued to anchors in the scene by projecting them every rendered
 * frame. The labels are ordinary elements of the page — no nested React roots, no fonts
 * fetched at run time. Mount it last inside the Canvas so it runs after everything moved.
 */
export function LabelProjector({ bindings }: { bindings: LabelBinding[] }) {
  const p = useMemo(() => new Vector3(), [])

  const placed = useMemo<{ x: number; y: number; w: number; h: number }[]>(() => [], [])

  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    placed.length = 0
    for (const { anchor, element } of bindings) {
      const el = element.current
      if (!el) continue
      const obj = anchor.current
      if (!obj) {
        el.style.visibility = 'hidden'
        continue
      }
      obj.getWorldPosition(p).project(camera)
      if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) {
        el.style.visibility = 'hidden'
        continue
      }
      // Keep the whole label inside the view when its anchor is close to an edge.
      const halfW = el.offsetWidth / 2 + EDGE_MARGIN_PX
      const halfH = el.offsetHeight / 2 + EDGE_MARGIN_PX
      const x = Math.min(Math.max(((p.x + 1) / 2) * size.width, halfW), Math.max(halfW, size.width - halfW))
      let y = Math.min(Math.max(((1 - p.y) / 2) * size.height, halfH), Math.max(halfH, size.height - halfH))
      // Two anchors can land on the same spot (Sun and Earth in nearly the same direction):
      // move the later label down until it clears the ones already placed.
      for (let attempt = 0; attempt < 6; attempt++) {
        const hit = placed.find((r) => Math.abs(r.x - x) < (r.w + el.offsetWidth) / 2 + 4 && Math.abs(r.y - y) < (r.h + el.offsetHeight) / 2 + 2)
        if (!hit) break
        y = hit.y + (hit.h + el.offsetHeight) / 2 + 3
      }
      placed.push({ x, y, w: el.offsetWidth, h: el.offsetHeight })
      el.style.visibility = 'visible'
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    }
  })

  return null
}
