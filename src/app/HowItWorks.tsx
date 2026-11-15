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
      // A stack: the current card in front, its neighbours smaller, fainter and behind it,
      // peeking out on either side. Everything follows the scroll position continuously.
      const spread = cards[0].offsetWidth * 0.42
      // On a phone only a sliver of each neighbour shows, so dim it further.
      const dim = window.innerWidth < 700 ? 0.72 : 0.55
      cards.forEach((card, index) => {
        const offset = index - progress
        const away = Math.abs(offset)
        const near = Math.min(away, 1)
        const far = Math.max(0, Math.min(away - 1, 1))
        card.style.transform = enabled ? `translateX(${offset * spread}px) scale(${1 - 0.14 * near - 0.08 * far})` : ''
        // Cards stay opaque so the front one always covers the ones behind; neighbours fade by
        // dimming, and only a card two steps away fades out.
        card.style.opacity = enabled ? String(1 - far) : ''
        card.style.zIndex = enabled ? String(1000 - Math.round(away * 100) * 2 + (offset < 0 ? 1 : 0)) : ''
        card.style.filter = enabled && near > 0.02 ? `brightness(${1 - dim * near}) saturate(${1 - 0.6 * near})` : ''
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
          <ol className="how__cards">
            <li className="how__card">
              <span className="how__number" aria-hidden="true">01</span>
              <h3>Pick a place and a date</h3>
              <p>Choose landing spots near the south pole, or any spot on their surrounding maps, and a start date within a year.</p>
              <span className="how__hint">Scroll to follow the mission</span>
            </li>
            <li className="how__card">
              <span className="how__number" aria-hidden="true">02</span>
              <h3>Watch the Sun and Earth over the terrain</h3>
              <p>The 3D simulation moves through the mission and shows when the skyline hides them.</p>
              <button type="button" className="link" onClick={onSimulation}>Open the simulation</button>
            </li>
            <li className="how__card">
              <span className="how__number" aria-hidden="true">03</span>
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
