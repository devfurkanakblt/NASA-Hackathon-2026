import { useEffect, useRef } from 'react'
import { HowItWorks } from './HowItWorks.tsx'
import type { HorizonDoc } from '../data/contract.ts'

interface Props {
  /** A real terrain horizon for the picture; a gentle placeholder ridge until the data is in. */
  horizon?: HorizonDoc
  onSimulation: () => void
  onResults: () => void
}

/** Introduction only: what the tool is for and how to use it. No mission numbers here. */
export function Landing({ onSimulation, onResults }: Props) {
  const landingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = landingRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Keyboard navigation stays instant; content is visible without animation support.
    if (!root || typeof root.animate !== 'function' || document.activeElement?.matches(':focus-visible')) return
    const animations: Animation[] = []
    const easing = 'cubic-bezier(0.23, 1, 0.32, 1)'
    const enter = (element: Element, delay = 0) => {
      animations.push(element.animate(
        reduced.matches
          ? [{ opacity: 0.7 }, { opacity: 1 }]
          : [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: reduced.matches ? 160 : 560, delay, easing, fill: 'backwards' },
      ))
    }
    root.querySelectorAll('.landing__hero h1, .landing__lead, .landing__actions').forEach((element, index) => enter(element, index * 70))
    const image = root.querySelector('.landing__hero-image')
    if (image && !reduced.matches) {
      animations.push(image.animate(
        [{ transform: 'scale(1.045)' }, { transform: 'scale(1)' }],
        { duration: 1600, easing },
      ))
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        if (!entry.target.contains(document.activeElement)) enter(entry.target)
        observer?.unobserve(entry.target)
      }
    }, { threshold: 0.12 })
    root.querySelectorAll('.landing__section').forEach((section) => {
      if (section.getBoundingClientRect().top >= window.innerHeight) observer?.observe(section)
    })
    const cancelMotion = () => animations.forEach((animation) => animation.cancel())
    const onKeyboard = () => cancelMotion()
    reduced.addEventListener('change', cancelMotion)
    root.addEventListener('keydown', onKeyboard)
    return () => {
      observer?.disconnect()
      cancelMotion()
      reduced.removeEventListener('change', cancelMotion)
      root.removeEventListener('keydown', onKeyboard)
    }
  }, [])

  return (
    <div className="landing" ref={landingRef}>
      <section className="landing__hero">
        <img className="landing__hero-image" src="/images/rimlight-lunar-hero-v1.webp" alt="" width="1672" height="941" fetchPriority="high" />
        <h1>Find the light before you land.</h1>
        <p className="landing__lead">
          Near the Moon&rsquo;s south pole the Sun and Earth skim the horizon. A hill or a crater rim decides whether a lander has power and whether it can talk to Earth.
          Rimlight shows it, place by place, with NASA terrain and ephemeris data.
        </p>
        <div className="landing__actions">
          <button type="button" className="primary" onClick={onSimulation}>
            Start the simulation
          </button>
          <button type="button" onClick={onResults}>
            See the results
          </button>
        </div>
      </section>


      <section className="landing__section landing__why">
        <h2>The light is on the rim.</h2>
        <div className="landing__cols">
          <p>
            At the pole the Sun never climbs high. It circles the sky just above the skyline, so the same sunlight that reaches a crater rim can miss the crater wall a short walk
            away.
          </p>
          <p>
            Earth hangs low too. A lander needs a clear line of sight to send its data home, and the terrain around it decides when that line is open and when it is blocked.
          </p>
          <p>
            Coordinates alone do not show this. Rimlight puts the real terrain, the Sun and Earth on one screen and answers two plain questions for every place you pick.
          </p>
        </div>
      </section>

      <HowItWorks onSimulation={onSimulation} onResults={onResults} />

      <section className="landing__section landing__data">
        <h2>Built on NASA data</h2>
        <p>
          Terrain from the laser altimeter on NASA&rsquo;s Lunar Reconnaissance Orbiter (LOLA). Sun and Earth positions from NASA JPL Horizons. Landing regions from NASA&rsquo;s
          Lunar Surface Data Book. Everything is computed ahead of time, so the app runs in the browser without a server.
        </p>
      </section>
    </div>
  )
}
