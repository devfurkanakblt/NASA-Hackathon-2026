import { useEffect, useRef } from 'react'

interface Props {
  onSimulation: () => void
  onResults: () => void
}

/** Native document scrolling drives two horizontal transitions, then releases the sticky stage. */
export function HowItWorks({ onSimulation, onResults }: Props) {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const stage = root.querySelector<HTMLElement>('.how__stage')!
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.how__card'))
    const steps = Array.from(root.querySelectorAll<HTMLElement>('.how__progress li'))
    const fallback = window.matchMedia('(prefers-reduced-motion: reduce), (max-height: 580px)')
    let frame = 0

    const render = () => {
      frame = 0
      const enabled = !fallback.matches
      root.classList.toggle('how--scroll', enabled)
      const travel = root.offsetHeight - stage.offsetHeight
      const progress = enabled ? Math.max(0, Math.min(2, -root.getBoundingClientRect().top / Math.max(1, travel) * 2)) : 0
      const active = Math.round(progress)
      // An orbit: the three cards sit 120° apart on a tilted ellipse. Scrolling turns the orbit,
      // so the front card swings back to the left as the next one comes round from the right.
      // Everything follows the scroll position continuously.
      const radiusX = cards[0].offsetWidth * (window.innerWidth < 700 ? 0.34 : 0.62)
      const rise = Math.min(stage.offsetHeight * 0.13, 70) // the far side of the orbit sits higher
      // On a phone only a sliver of each card behind shows, so dim it further.
      const dim = window.innerWidth < 700 ? 0.72 : 0.6
      cards.forEach((card, index) => {
        const angle = (index - progress) * (Math.PI * 2 / 3)
        const depth = (1 + Math.cos(angle)) / 2 // 1 in front, 0 at the back
        const behind = 1 - depth
        card.style.transform = enabled
          ? `translate3d(${Math.sin(angle) * radiusX}px, ${-behind * rise}px, 0) rotateY(${Math.sin(angle) * -14}deg) scale(${0.66 + 0.34 * depth})`
          : ''
        // Cards stay opaque so the front one always covers the ones behind; depth reads as dimming.
        card.style.opacity = ''
        card.style.zIndex = enabled ? String(Math.round(depth * 1000)) : ''
        card.style.filter = enabled && behind > 0.01 ? `brightness(${1 - dim * behind}) saturate(${1 - 0.6 * behind})` : ''
        // Cards behind the current one cannot receive focus or appear in the accessibility tree.
        card.inert = enabled && index !== active
      })
      steps.forEach((step, index) => {
        if (index === active) step.setAttribute('aria-current', 'step')
        else step.removeAttribute('aria-current')
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render)
    }
    render()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    fallback.addEventListener('change', schedule)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(stage)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      fallback.removeEventListener('change', schedule)
      resize?.disconnect()
    }
  }, [])

  return (
    <section className="how" ref={rootRef} aria-labelledby="how-title">
      <div className="how__stage">
        <h2 id="how-title">How it works</h2>
        <div className="how__viewport">
          <span className="how__orbit" aria-hidden="true" />
          <ol className="how__cards">
            <li className="how__card">
              <span className="how__number" aria-hidden="true">1</span>
              <h3>Pick a place and a date</h3>
              <p>Choose landing spots near the south pole, or any spot on their surrounding maps, and a start date within a year.</p>
              <span className="how__hint">Scroll to follow the mission</span>
            </li>
            <li className="how__card">
              <span className="how__number" aria-hidden="true">2</span>
              <h3>Watch the Sun and Earth over the terrain</h3>
              <p>The 3D simulation moves through the mission and shows when the skyline hides them.</p>
              <button type="button" className="link" onClick={onSimulation}>Open the simulation</button>
            </li>
            <li className="how__card">
              <span className="how__number" aria-hidden="true">3</span>
              <h3>Read the answer</h3>
              <p>Will the lander have power? Can it talk to Earth? Each place gets a plain answer, with the charts behind it.</p>
              <button type="button" className="link" onClick={onResults}>See the results</button>
            </li>
          </ol>
        </div>
        <ol className="how__progress" aria-label="Mission steps">
          <li aria-label="Step 1: Pick a place" aria-current="step"><span /></li>
          <li aria-label="Step 2: Watch the simulation"><span /></li>
          <li aria-label="Step 3: Read the answer"><span /></li>
        </ol>
      </div>
    </section>
  )
}
