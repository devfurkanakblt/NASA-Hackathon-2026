import { useId, useMemo } from 'react'
import type { HorizonDoc } from '../data/contract.ts'

/**
 * Rimlight symbol (v2): the Moon's disc as a 360° horizon ring, lit only on the sunward edge.
 * Two soft ridges give depth: the Sun sits behind the distant one (only its cap clears the
 * horizon) and the near ridge's crest catches the light. Earth is the blue dot.
 * Below 32 px a simpler single-ridge version is drawn and the Earth dot is left out.
 */
export function RimlightMark({ size = 40 }: { size?: number }) {
  const clip = useId()
  const small = size < 32
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <circle cx="48" cy="48" r="35.5" />
        </clipPath>
      </defs>
      <circle cx="48" cy="48" r="38" fill="none" stroke="#34405a" strokeWidth={small ? 8 : 5} />
      <path d="M41.4 10.6 A38 38 0 0 1 85.4 54.6" fill="none" stroke="#ffd166" strokeWidth={small ? 8 : 5} strokeLinecap="round" />
      <g clipPath={`url(#${clip})`}>
        {small ? (
          <>
            <circle cx="63" cy="56" r="11" fill="#ffd166" />
            <path d="M4 63 C22 54 38 57 50 57 C62 57 76 52 92 57 L92 96 L4 96 Z" fill="#263044" />
            <path d="M4 63 C22 54 38 57 50 57 C62 57 76 52 92 57" fill="none" stroke="#e8ecf3" strokeWidth="5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="31" cy="30" r="4" fill="#9db7ff" />
            <circle cx="65" cy="53" r="8" fill="#ffd166" />
            <path d="M4 56 C14 52 22 50 31 52 C40 54 45 47 53 46.5 C60 46 62 50.5 69 50.5 C77 50.5 83 46 92 48 L92 96 L4 96 Z" fill="#34405a" />
            <path d="M4 67 C15 61 25 58.5 35 61.5 C45 64.5 52 59 61 58.5 C71 58 79 64 92 62 L92 96 L4 96 Z" fill="#1a2130" />
            <path d="M4 67 C15 61 25 58.5 35 61.5 C45 64.5 52 59 61 58.5 C71 58 79 64 92 62" fill="none" stroke="#e8ecf3" strokeWidth="3" strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  )
}

const RULE_H = 34

/**
 * Section divider drawn from a real terrain horizon (all 360° of azimuth, north at both ends),
 * the brand's "horizon as signature". Purely decorative; the panorama is the readable version.
 */
export function HorizonRule({ horizon, siteName }: { horizon?: HorizonDoc; siteName?: string }) {
  const path = useMemo(() => {
    if (!horizon || horizon.count === 0) return null
    const step = Math.max(1, Math.floor(horizon.count / 720))
    let lo = Infinity
    let hi = -Infinity
    for (const v of horizon.elevDeg) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const span = Math.max(2, hi - lo)
    const y = (v: number) => (RULE_H - 2 - ((v - lo) / span) * (RULE_H - 6)).toFixed(1)
    let d = ''
    for (let i = 0; i <= horizon.count; i += step) {
      const v = horizon.elevDeg[i % horizon.count]
      d += `${i === 0 ? 'M' : 'L'}${((i / horizon.count) * 1000).toFixed(1)},${y(v)}`
    }
    return { line: d, area: `${d}L1000,${RULE_H}L0,${RULE_H}Z` }
  }, [horizon])

  return (
    <div className="horizon-rule" aria-hidden="true">
      <svg viewBox={`0 0 1000 ${RULE_H}`} preserveAspectRatio="none" width="100%" height={RULE_H}>
        {path ? (
          <>
            <path d={path.area} className="horizon-rule__ground" />
            <path d={path.line} className="horizon-rule__line" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <line x1="0" x2="1000" y1={RULE_H - 1} y2={RULE_H - 1} className="horizon-rule__line" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {siteName && <span className="horizon-rule__label">Skyline of {siteName}, 0–360°</span>}
    </div>
  )
}
