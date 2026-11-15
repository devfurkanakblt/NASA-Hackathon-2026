import { useEffect, useRef } from 'react'
import { RimlightMark } from './Brand.tsx'

interface Props {
  onHome: () => void
  onSimulation: () => void
  onResults: () => void
  onSources: () => void
}

export function MissionFooter({ onHome, onSimulation, onResults, onSources }: Props) {
  const footerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = footerRef.current
    if (!root || typeof IntersectionObserver === 'undefined' || typeof root.animate !== 'function') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animations: Animation[] = []
    let keyboard = document.activeElement?.matches(':focus-visible') ?? false
    const cancel = () => animations.forEach((animation) => animation.cancel())
    const onKey = () => { keyboard = true; cancel() }
    const onPointer = () => { keyboard = false }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        if (keyboard || entry.target.contains(document.activeElement)) continue
        const image = entry.target.matches('.mission-footer__image')
        const frames = reduced.matches
          ? [{ opacity: 0.75 }, { opacity: 1 }]
          : image
            ? [{ transform: 'scale(1.035)' }, { transform: 'scale(1)' }]
            : [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }]
        animations.push(entry.target.animate(frames, {
          duration: reduced.matches ? 180 : image ? 1200 : 640,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }))
      }
    }, { threshold: 0.15 })
    root.querySelectorAll('[data-footer-reveal], .mission-footer__image').forEach((element) => observer.observe(element))
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, { passive: true })
    reduced.addEventListener('change', cancel)
    return () => {
      observer.disconnect()
      cancel()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      reduced.removeEventListener('change', cancel)
    }
  }, [])

  return (
    <footer className="mission-footer" ref={footerRef}>
      <div className="mission-footer__invitation">
        <img className="mission-footer__image" src="/images/rimlight-footer-orbit-v1.webp" width="1536" height="1024" alt="" loading="lazy" decoding="async" />
        <div data-footer-reveal>
          <h2>Your next mission<br />starts on the rim.</h2>
          <p>Find sunlight. Keep power. Stay connected.</p>
        </div>
        <button type="button" className="mission-footer__launch" onClick={onSimulation}>
          <span>Explore the Moon</span>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg>
        </button>
        <span className="mission-footer__caption">Lunar limb / Artist&rsquo;s impression</span>
      </div>
      <div className="mission-footer__details">
        <div className="mission-footer__about">
          <RimlightMark size={40} />
          <p>A little light makes<br />a world of difference.</p>
          <span>Lunar Landing Site Navigator</span>
        </div>
        <nav aria-label="Footer navigation">
          <h3>Explore</h3>
          <button type="button" onClick={onHome}>Home</button>
          <button type="button" onClick={onSimulation}>Simulation</button>
          <button type="button" onClick={onResults}>Results</button>
        </nav>
        <div className="mission-footer__sources">
          <h3>Grounded in data</h3>
          <p>NASA LOLA terrain<br />JPL Horizons ephemerides<br />Lunar Surface Data Book</p>
          <button type="button" onClick={onSources}>Explore data &amp; limits <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg></button>
        </div>
      </div>
      <div className="mission-footer__signature" data-footer-reveal aria-hidden="true">RIMLIGHT<span>.</span></div>
      <div className="mission-footer__bottom">
        <span>Research regions, not certified landing sites. Built on NASA data; not endorsed by NASA.</span>
        <span>Sunlight. Power. A connection home.</span>
      </div>
    </footer>
  )
}
