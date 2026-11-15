import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { HeroCopy } from './HeroCopy.tsx'
import { descentPose, MOON_RADIUS_KM } from './descentPath.ts'
import type { DescentPose } from './descentPath.ts'
import type { DescentProgress } from './MoonScene.tsx'

gsap.registerPlugin(ScrollTrigger)

const MoonScene = lazy(() => import('./MoonScene.tsx'))
const HERO_IMAGE = `${import.meta.env.BASE_URL}images/rimlight-lunar-hero-v1.webp`
const FOV = 32 // matches DESCENT_FOV; kept here so the telemetry does not pull in the 3D chunk

/** Timeline marks, in scroll progress. The last 3D frame is the hero background. */
const SHADE_IN: [number, number] = [0.86, 0.96]
const REVEAL_AT = 0.94
const HIDE_BELOW = 0.9

type Mode = 'cinematic' | 'static'

interface Props {
  onSimulation: () => void
  onResults: () => void
}

function supportsWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** The 3D descent only where it will run well; everyone else gets the original still hero. */
function chooseMode(): Mode {
  if (typeof window === 'undefined') return 'static'
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'static'
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  if (nav.connection?.saveData) return 'static'
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 3) return 'static'
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4) return 'static'
  return supportsWebGL2() ? 'cinematic' : 'static'
}

const isMobile = () => window.matchMedia('(max-width: 700px), (pointer: coarse)').matches

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

export function LunarDescent({ onSimulation, onResults }: Props) {
  const [mode, setMode] = useState<Mode>(chooseMode)

  // Turning on reduced motion mid-visit drops straight to the still hero.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => { if (query.matches) setMode('static') }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const fallBack = useCallback(() => setMode('static'), [])
  return mode === 'cinematic'
    ? <CinematicDescent onSimulation={onSimulation} onResults={onResults} onFail={fallBack} />
    : <StaticHero onSimulation={onSimulation} onResults={onResults} />
}

/** The original hero: still terrain image, the copy enters once. */
function StaticHero({ onSimulation, onResults }: Props) {
  const reduced = useReducedMotion()
  return (
    <section className="landing__hero">
      <motion.img
        className="landing__hero-image"
        src={HERO_IMAGE}
        alt=""
        width="1672"
        height="941"
        fetchPriority="high"
        initial={reduced ? false : { scale: 1.045 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.6, ease: [0.23, 1, 0.32, 1] }}
      />
      <HeroCopy revealed onSimulation={onSimulation} onResults={onResults} />
    </section>
  )
}

function CinematicDescent({ onSimulation, onResults, onFail }: Props & { onFail: () => void }) {
  const root = useRef<HTMLElement>(null)
  const space = useRef<HTMLDivElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  const hud = useRef<HTMLDivElement>(null)
  const cue = useRef<HTMLDivElement>(null)
  const altitude = useRef<HTMLSpanElement>(null)
  const latitude = useRef<HTMLSpanElement>(null)
  const longitude = useRef<HTMLSpanElement>(null)
  const [progress] = useState<DescentProgress>(() => ({ value: 0 }))
  const [mobile] = useState(isMobile)
  const [ready, setReady] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  const onReady = useCallback(() => setReady(true), [])

  // GSAP ScrollTrigger is the single source of truth for everything scroll-linked: camera
  // progress, the reading shade, the HUD and the telemetry. Motion only animates the
  // hero copy (its own elements), so the two libraries never write the same property.
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const home = el.closest('.app--home')
    const header = home?.querySelector<HTMLElement>(':scope > .app__header')
    home?.classList.add('has-descent')
    const pose: { current?: DescentPose } = {}
    const writeTelemetry = (p: number) => {
      const view = el.querySelector('.descent__stage') as HTMLElement
      const aspect = view.clientWidth / Math.max(1, view.clientHeight)
      pose.current = descentPose(p, FOV, aspect, pose.current)
      const km = pose.current.altitude * MOON_RADIUS_KM
      if (altitude.current) altitude.current.textContent = km >= 100 ? Math.round(km).toLocaleString('en-US') : km.toFixed(1)
      if (latitude.current) latitude.current.textContent = Math.abs(pose.current.latitude).toFixed(1)
      if (longitude.current) {
        const { x, z } = pose.current.position
        const lon = Math.atan2(-z, x) * 180 / Math.PI // Moon frame: -Z is 90° E
        longitude.current.textContent = `${Math.abs(lon).toFixed(1)}° ${lon < 0 ? 'W' : 'E'}`
      }
    }
    const setReveal = (p: number) => {
      const next = revealedRef.current ? p >= HIDE_BELOW : p >= REVEAL_AT
      if (next !== revealedRef.current) { revealedRef.current = next; setRevealed(next) }
    }

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom bottom',
          scrub: mobile ? 0.5 : 0.9,
          invalidateOnRefresh: true,
        },
        onUpdate: () => {
          progress.invalidate?.()
          writeTelemetry(progress.value)
          setReveal(progress.value)
        },
      })
      timeline
        .to(progress, { value: 1, duration: 1 }, 0)
        .fromTo(cue.current, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.06 }, 0)
        .fromTo(hud.current, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.08 }, SHADE_IN[0] - 0.06)
        // The landed view stays as the hero background; only the reading gradient comes in.
        .fromTo(shade.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: SHADE_IN[1] - SHADE_IN[0], ease: 'power1.inOut' }, SHADE_IN[0])

      // The navbar rides on the pinned stage: fixed during the descent, then it leaves the
      // screen 1:1 with the stage once the sticky releases, exactly as on the still hero.
      if (header) {
        gsap.fromTo(header, { y: 0 }, {
          y: () => -window.innerHeight,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'bottom bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
        })
      }
    }, el)
    writeTelemetry(0)
    return () => {
      ctx.revert()
      home?.classList.remove('has-descent')
    }
  }, [mobile, progress])

  // Layout can shift once fonts and the 3D chunk land; let ScrollTrigger re-measure.
  useEffect(() => {
    if (ready) ScrollTrigger.refresh()
  }, [ready])

  return (
    <section ref={root} className={`descent${mobile ? ' descent--mobile' : ''}`}>
      <div className="descent__stage">
        <div ref={space} className="descent__space">
          <div className={`descent__canvas${ready ? ' is-ready' : ''}`}>
            <SceneBoundary onError={onFail}>
              <Suspense fallback={null}>
                <MoonScene progress={progress} mobile={mobile} onReady={onReady} onError={onFail} />
              </Suspense>
            </SceneBoundary>
          </div>
        </div>

        <div ref={shade} className="descent__shade" aria-hidden="true" />

        <div ref={hud} className="descent__hud" aria-hidden="true">
          <p className="descent__eyebrow">Lunar south pole</p>
          <dl className="descent__telemetry">
            <div><dt>Alt</dt><dd><span ref={altitude}>0</span> km</dd></div>
            <div><dt>Lat</dt><dd><span ref={latitude}>0</span>° S</dd></div>
            <div><dt>Lon</dt><dd><span ref={longitude}>0° E</span></dd></div>
          </dl>
          <p className="descent__credit">NASA / GSFC / Arizona State University · LROC</p>
        </div>

        {!ready && (
          <div className="descent__loading" role="status">
            <span className="descent__loading-bar" aria-hidden="true" />
            <span>Loading NASA lunar imagery</span>
          </div>
        )}

        <div ref={cue} className="descent__cue" aria-hidden="true">
          <span>Scroll to descend</span>
          <span className="descent__cue-line" />
        </div>

        <div className="descent__copy">
          <HeroCopy
            revealed={revealed}
            onSimulation={onSimulation}
            onResults={onResults}
            onFocusWithin={() => { revealedRef.current = true; setRevealed(true) }}
          />
        </div>
      </div>
    </section>
  )
}
