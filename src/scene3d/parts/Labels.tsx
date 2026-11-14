import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import type { RefObject } from 'react'
import { Vector3 } from 'three'
import type { Object3D } from 'three'
import { placeLabel } from '../labelLayout.ts'
import type { LabelBox } from '../labelLayout.ts'

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

  const placed = useMemo<LabelBox[]>(() => [], [])

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
      el.style.maxWidth = `${Math.max(1, size.width - 8)}px`
      el.style.boxSizing = 'border-box'
      el.style.overflow = 'hidden'
      el.style.textOverflow = 'ellipsis'
      const box = placeLabel({ x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height,
        w: el.offsetWidth, h: el.offsetHeight }, size.width, size.height, placed)
      placed.push(box)
      el.style.visibility = 'visible'
      el.style.transform = `translate(-50%, -50%) translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`
    }
  })

  return null
}
