import { useEffect, useRef, useState } from 'react'

/** Width of an element in CSS pixels, kept up to date as the layout changes. */
export function useWidth<T extends HTMLElement>(initial = 800) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Round step for axis ticks covering `span` with roughly `target` ticks. */
export function niceStep(span: number, target = 6): number {
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow
  return 10 * pow
}

export function ticks(lo: number, hi: number, target = 6): number[] {
  const step = niceStep(hi - lo, target)
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}
