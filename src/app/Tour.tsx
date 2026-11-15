import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface TourStep {
  /** `data-tour` value of the element to highlight; none = centred card. */
  target?: string
  title: string
  body: string
  /** Runs before the step is shown (e.g. switch to the tab that holds the target). */
  before?: () => void
}

interface Props {
  steps: TourStep[]
  open: boolean
  onClose: () => void
}

const PAD = 8
const CARD_W = 340

/** Short guided tour: dims the page, outlines one part of it and explains it in a sentence or two. */
export function Tour({ steps, open, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const step = steps[index]

  const measure = useCallback(() => {
    const el = step?.target ? document.querySelector(`[data-tour="${step.target}"]`) : null
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  // Reset to the first step each time the tour opens.
  const [openedAt, setOpenedAt] = useState(open)
  if (open !== openedAt) {
    setOpenedAt(open)
    if (open) setIndex(0)
  }

  useLayoutEffect(() => {
    if (!open || !step) return
    step.before?.()
    // Let the tab switch render, then bring the target into view and measure it.
    const frame = requestAnimationFrame(() => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      measure()
      cardRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, step, measure])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(steps.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, onClose, measure, steps.length])

  if (!open || !step) return null
  const last = index === steps.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight
  const narrow = vw < 640

  // Card goes below the target if there is room, else above; centred when there is no target.
  let cardStyle: CSSProperties = {}
  if (rect && !narrow) {
    const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12)
    const below = rect.bottom + PAD + 12
    cardStyle = below + 200 < vh ? { left, top: below } : { left, bottom: Math.max(12, vh - rect.top + PAD + 12) }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div className="tour__spot" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }} />
      ) : (
        <div className="tour__shade" />
      )}
      <div ref={cardRef} tabIndex={-1} className={`tour__card${!rect ? ' is-centre' : ''}${narrow && rect ? ' is-docked' : ''}`} style={cardStyle}>
        <div className="tour__progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <i key={s.title} className={i <= index ? 'is-on' : undefined} />
          ))}
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour__actions">
          <button type="button" className="link" onClick={onClose}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span>
            {index > 0 && (
              <button type="button" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button type="button" className="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? 'Start exploring' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
