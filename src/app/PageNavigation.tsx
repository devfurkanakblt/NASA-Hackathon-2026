import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type View = 'home' | 'simulation' | 'results'
const VIEWS: { key: View; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'simulation', label: 'Simulation' },
  { key: 'results', label: 'Results' },
]

export function PageNavigation({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const navRef = useRef<HTMLElement>(null)
  const shadeRef = useRef<HTMLDivElement>(null)
  const previous = useRef(view)
  const positioned = useRef(false)
  const instant = useRef(false)
  const animation = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const position = () => {
      const active = nav.querySelector<HTMLButtonElement>('[aria-current="page"]')
      const line = nav.querySelector<HTMLElement>('.pages__line')
      if (active && line) line.style.transform = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})`
    }
    nav.dataset.instant = String(!positioned.current || instant.current || reduced.matches)
    position()
    positioned.current = true
    if (previous.current !== view) {
      animation.current?.cancel()
      if (!instant.current && !reduced.matches && shadeRef.current?.animate) {
        animation.current = shadeRef.current.animate(
          [
            { opacity: 0.58, offset: 0 },
            { opacity: 0.58, offset: 0.18 },
            { opacity: 0, offset: 1, easing: 'linear' },
          ],
          { duration: 420, easing: 'linear' },
        )
      }
      previous.current = view
    }
    let firstObservation = true
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (firstObservation) { firstObservation = false; return }
      // Responsive reflow is immediate; only changing pages slides the underline.
      nav.dataset.instant = 'true'
      position()
    })
    observer?.observe(nav)
    nav.querySelectorAll('button').forEach((button) => observer?.observe(button))
    const stopMotion = () => { animation.current?.cancel(); nav.dataset.instant = 'true'; position() }
    reduced.addEventListener('change', stopMotion)
    return () => {
      observer?.disconnect()
      reduced.removeEventListener('change', stopMotion)
    }
  }, [view])

  useLayoutEffect(() => () => animation.current?.cancel(), [])

  return (
    <nav className="pages" aria-label="Pages" ref={navRef}>
      {VIEWS.map((item) => (
        <button key={item.key} type="button" className={view === item.key ? 'is-on' : undefined}
          aria-current={view === item.key ? 'page' : undefined}
          onClick={(event) => {
            instant.current = event.detail === 0
            if (navRef.current) navRef.current.dataset.instant = String(instant.current)
            if (item.key !== view) onChange(item.key)
          }}>
          {item.label}
        </button>
      ))}
      <span className="pages__line" aria-hidden="true" />
      {createPortal(<div className="page-shade" ref={shadeRef} aria-hidden="true" />, document.body)}
    </nav>
  )
}
