import { motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'

const EASE = [0.23, 1, 0.32, 1] as const
const HEADLINE = 'Find the light before you land.'

interface Props {
  /** Shown or hidden; Motion owns the copy's opacity and transform, nothing else animates them. */
  revealed: boolean
  onSimulation: () => void
  onResults: () => void
  /** Keyboard focus inside the copy must make it visible. */
  onFocusWithin?: () => void
}

/** The existing hero text and buttons, with Motion entrance and pointer feedback. */
export function HeroCopy({ revealed, onSimulation, onResults, onFocusWithin }: Props) {
  const reduced = useReducedMotion()

  const group: Variants = {
    hidden: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
    shown: { transition: { staggerChildren: reduced ? 0 : 0.11, delayChildren: 0.05 } },
  }
  const words: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: reduced ? 0 : 0.045 } },
  }
  const rise: Variants = reduced
    ? { hidden: { opacity: 0, transition: { duration: 0.15 } }, shown: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        hidden: { opacity: 0, y: 14, filter: 'blur(6px)', transition: { duration: 0.3, ease: EASE } },
        shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: EASE } },
      }
  const word: Variants = reduced
    ? rise
    : {
        hidden: { opacity: 0, y: '0.42em', filter: 'blur(8px)', transition: { duration: 0.3, ease: EASE } },
        shown: { opacity: 1, y: '0em', filter: 'blur(0px)', transition: { duration: 1.0, ease: EASE } },
      }
  const press = reduced ? {} : {
    whileHover: { y: -2 },
    whileTap: { y: 0, scale: 0.97 },
    transition: { type: 'spring' as const, stiffness: 520, damping: 32, mass: 0.6 },
  }

  return (
    <motion.div
      className="hero-copy"
      initial="hidden"
      animate={revealed ? 'shown' : 'hidden'}
      variants={group}
      onFocus={onFocusWithin}
      data-revealed={revealed || undefined}
    >
      <motion.h1 variants={words} aria-label={HEADLINE}>
        {HEADLINE.split(' ').map((w, i) => (
          <span key={i} aria-hidden="true">
            <motion.span className="hero-copy__word" variants={word}>{w}</motion.span>{' '}
          </span>
        ))}
      </motion.h1>
      <motion.p className="landing__lead" variants={rise}>
        Near the Moon&rsquo;s south pole the Sun and Earth skim the horizon. A hill or a crater rim decides whether a lander has power and whether it can talk to Earth.
        Rimlight shows it, place by place, with NASA terrain and ephemeris data.
      </motion.p>
      <motion.div className="landing__actions" variants={rise}>
        <motion.button type="button" className="primary" onClick={onSimulation} {...press}>
          Start the simulation
        </motion.button>
        <motion.button type="button" onClick={onResults} {...press}>
          See the results
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
