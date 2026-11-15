import { useMemo } from 'react'
import type { HorizonDoc } from '../data/contract.ts'

interface Props {
  /** A real terrain horizon for the picture; a gentle placeholder ridge until the data is in. */
  horizon?: HorizonDoc
  onSimulation: () => void
  onResults: () => void
}

const W = 1200
const H = 260

/** Skyline picture: the real 360° horizon of a site, the Sun low on the rim, Earth above it. */
function SkylinePicture({ horizon }: { horizon?: HorizonDoc }) {
  const shape = useMemo(() => {
    const n = 480
    const values: number[] = []
    for (let i = 0; i < n; i++) {
      if (horizon && horizon.count > 0) values.push(horizon.elevDeg[Math.floor((i / n) * horizon.count)])
      else values.push(2 + Math.sin(i / 23) * 1.5 + Math.sin(i / 7) * 0.4)
    }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = Math.max(1, hi - lo)
    const y = (v: number) => H - 30 - ((v - lo) / span) * (H * 0.55)
    const pts = values.map((v, i) => [(i / (n - 1)) * W, y(v)] as const)
    // Put the Sun where the ridge is low, so it sits just on the rim.
    let low = Math.floor(n * 0.62)
    for (let i = Math.floor(n * 0.5); i < Math.floor(n * 0.9); i++) if (pts[i][1] > pts[low][1]) low = i
    const line = pts.map(([x, yy], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yy.toFixed(1)}`).join('')
    return { line, area: `${line}L${W},${H}L0,${H}Z`, sun: pts[low] }
  }, [horizon])

  return (
    <svg className="landing__picture" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="landing-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#263044" />
          <stop offset="1" stopColor="#0b0e14" />
        </linearGradient>
        <linearGradient id="landing-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e8ecf3" stopOpacity="0.15" />
          <stop offset={(shape.sun[0] / W).toFixed(3)} stopColor="#ffd166" />
          <stop offset="1" stopColor="#e8ecf3" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <circle cx={W * 0.22} cy={H * 0.2} r="7" fill="#9db7ff" />
      <circle cx={shape.sun[0]} cy={shape.sun[1] - 4} r="16" fill="#ffd166" />
      <path d={shape.area} fill="url(#landing-ground)" />
      <path d={shape.line} fill="none" stroke="url(#landing-rim)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Introduction only: what the tool is for and how to use it. No mission numbers here. */
export function Landing({ horizon, onSimulation, onResults }: Props) {
  return (
    <div className="landing">
      <section className="landing__hero">
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

      <SkylinePicture horizon={horizon} />

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

      <section className="landing__section">
        <h2>How it works</h2>
        <ol className="landing__steps">
          <li>
            <b>Pick a place and a date</b>
            <span>Choose landing spots near the south pole, or any spot on their surrounding maps, and a start date within a year.</span>
          </li>
          <li>
            <b>Watch the Sun and Earth over the terrain</b>
            <span>The 3D simulation moves through the mission and shows when the skyline hides them.</span>
            <button type="button" className="link" onClick={onSimulation}>
              Open the simulation
            </button>
          </li>
          <li>
            <b>Read the answer</b>
            <span>Will the lander have power? Can it talk to Earth? Each place gets a plain answer, with the charts behind it.</span>
            <button type="button" className="link" onClick={onResults}>
              See the results
            </button>
          </li>
        </ol>
      </section>

      <section className="landing__section landing__data">
        <h2>Built on NASA data</h2>
        <p>
          Terrain from the laser altimeter on NASA&rsquo;s Lunar Reconnaissance Orbiter (LOLA). Sun and Earth positions from NASA JPL Horizons. Landing regions from NASA&rsquo;s
          Lunar Surface Data Book. Everything is computed ahead of time, so the app runs in the browser without a server.
        </p>
        <p className="muted">No hidden score. Just conditions.</p>
      </section>
    </div>
  )
}
