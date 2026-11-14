import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { MapDoc, SiteEntry } from '../../data/contract.ts'
import { fmtDuration } from '../format.ts'
import { LAYERS, cellAt, centreCell, rampColor, rampFor, rgbCss, sitesOnMap } from '../mapGrid.ts'
import type { MapCell, MapLayer } from '../mapGrid.ts'
import { useWidth } from './useWidth.ts'

interface Props {
  map: MapDoc
  sites: SiteEntry[]
}

const MAX_SIZE = 460
const fmtM = (m: number) => (Math.abs(m) < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)
const offset = (c: MapCell) => (c.distanceM === 0 ? 'site centre' : `${fmtM(Math.abs(c.eastM))} ${c.eastM >= 0 ? 'east' : 'west'}, ${fmtM(Math.abs(c.northM))} ${c.northM >= 0 ? 'north' : 'south'}`)
const fmtLongest = (s: number | null) => (s == null ? '—' : s === 0 ? 'never lost' : fmtDuration(s))
/** Map values can be null (e.g. slope where the 5 m DEM has no data). */
const fmtNum = (v: number | null, unit: string) => (v == null || !Number.isFinite(v) ? 'no data' : `${(Math.round(v * 10) / 10).toFixed(1)}${unit}`)
const NO_DATA: [number, number, number] = [58, 62, 72]

/**
 * Regional map (`map.json`): ±3 km around the site, one cell per 100 m (or 200 m), coloured by
 * Sun / Earth / both in view or by slope. North up, east right. Values are period summaries;
 * the cells have no time series, so a cell cannot be simulated as a scenario.
 */
export function SiteMap({ map, sites }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(MAX_SIZE)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [layer, setLayer] = useState<MapLayer>('sunPct')
  const [hover, setHover] = useState<MapCell | null>(null)
  // The pick belongs to one map; another site's map starts at its centre again.
  const [pick, setPick] = useState<{ map: MapDoc; cell: MapCell } | null>(null)
  const picked = pick && pick.map === map ? pick.cell : centreCell(map)
  const setPicked = (next: MapCell | ((c: MapCell) => MapCell)) => setPick({ map, cell: typeof next === 'function' ? next(picked) : next })

  const { nx, ny, spacingM, halfSizeM } = map.grid
  const size = Math.min(MAX_SIZE, width)
  const cellPx = size / nx
  const meta = LAYERS.find((l) => l.key === layer)!
  const others = useMemo(() => sitesOnMap(map, sites), [map, sites])
  const centre = centreCell(map)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    // One pixel per cell, scaled up by CSS without smoothing.
    canvas.width = nx
    canvas.height = ny
    const image = ctx.createImageData(nx, ny)
    const ramp = rampFor(layer)
    const values = map[layer]
    for (let row = 0; row < ny; row++)
      for (let col = 0; col < nx; col++) {
        const v = values[row * nx + col] as number | null
        const [r, g, b] = v == null ? NO_DATA : rampColor(ramp, v / meta.max)
        const p = ((ny - 1 - row) * nx + col) * 4 // row 0 = south → bottom of the image
        image.data[p] = r
        image.data[p + 1] = g
        image.data[p + 2] = b
        image.data[p + 3] = 255
      }
    ctx.putImageData(image, 0, 0)
  }, [map, layer, nx, ny, meta.max])

  const cellFromEvent = (e: MouseEvent<HTMLElement>): MapCell | null => {
    const box = e.currentTarget.getBoundingClientRect()
    const col = Math.floor(((e.clientX - box.left) / box.width) * nx)
    const row = ny - 1 - Math.floor(((e.clientY - box.top) / box.height) * ny)
    return col >= 0 && col < nx && row >= 0 && row < ny ? cellAt(map, row, col) : null
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const move: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const d = move[e.key]
    if (!d) return
    e.preventDefault()
    setPicked((c) => cellAt(map, Math.min(ny - 1, Math.max(0, c.row + d[0])), Math.min(nx - 1, Math.max(0, c.col + d[1]))))
  }
  const px = (c: MapCell) => ({ left: (c.col + 0.5) * cellPx, top: (ny - 1 - c.row + 0.5) * cellPx })
  const periodLabel = `${map.coverage.startUtc.slice(0, 10)} – ${map.coverage.endUtc.slice(0, 10)}`
  const legendStops = rampFor(layer).map((_, i, all) => rgbCss(rampColor(all, i / (all.length - 1))))

  return (
    <div className="sitemap" ref={ref}>
      <div className="segmented" role="radiogroup" aria-label="Map layer">
        {LAYERS.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={layer === l.key} className={layer === l.key ? 'is-on' : undefined} onClick={() => setLayer(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="sitemap__body">
        <div
          className="sitemap__plot"
          style={{ width: size, height: size }}
          tabIndex={0}
          role="application"
          aria-label={`${meta.label} map, ${2 * halfSizeM / 1000} km square around ${map.siteId}. Click a cell or use the arrow keys to read its values.`}
          onPointerMove={(e) => setHover(cellFromEvent(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const c = cellFromEvent(e)
            if (c) setPicked(c)
          }}
          onKeyDown={onKey}
        >
          <canvas ref={canvasRef} style={{ width: size, height: size }} />
          <span className="sitemap__north" aria-hidden>
            N ↑
          </span>
          <span className="sitemap__mark sitemap__mark--centre" style={px(centre)} title={`${map.siteId} (site centre)`}>
            <i />
            <b>{map.siteId}</b>
          </span>
          {others.map(({ site, cell }) => (
            <span key={site.id} className="sitemap__mark" style={px(cell)} title={`${site.id}, ${offset(cell)}`}>
              <i />
              <b>{site.id}</b>
            </span>
          ))}
          <span className="sitemap__pick" style={{ ...px(picked), width: Math.max(6, cellPx + 2), height: Math.max(6, cellPx + 2) }} aria-hidden />
          {hover && (
            <span className={`sitemap__tip${px(hover).left > size * 0.6 ? ' is-left' : ''}`} style={px(hover)} aria-hidden>
              {meta.label}: {fmtNum(map[layer][hover.index], meta.unit === '%' ? ' %' : meta.unit)}
              <br />
              <span className="muted">{offset(hover)}</span>
            </span>
          )}
        </div>

        <div className="sitemap__side">
          <div className="sitemap__legend">
            <span className="small muted">{meta.label}</span>
            <span className="sitemap__ramp" style={{ background: `linear-gradient(to right, ${legendStops.join(', ')})` }} />
            <span className="sitemap__ramp-labels small muted">
              <span>0{meta.unit}</span>
              <span>
                {meta.key === 'slopeDeg' ? '≥ ' : ''}
                {meta.max}
                {meta.unit}
              </span>
            </span>
          </div>

          <dl className="sitemap__cell" aria-live="polite">
            <dt>Selected cell</dt>
            <dd>
              {offset(picked)}
              {picked.distanceM > 0 && <span className="muted"> ({fmtM(picked.distanceM)} from {map.siteId})</span>}
            </dd>
            <dt>Sun in view</dt>
            <dd>{fmtNum(picked.sunPct, ' %')}</dd>
            <dt>Earth in view</dt>
            <dd>{fmtNum(picked.earthPct, ' %')}</dd>
            <dt>Both in view</dt>
            <dd>{fmtNum(picked.bothPct, ' %')}</dd>
            <dt>Longest without Sun</dt>
            <dd>{fmtLongest(picked.longestNoSunS)}</dd>
            <dt>Longest without Earth</dt>
            <dd>{fmtLongest(picked.longestNoEarthS)}</dd>
            <dt>Slope</dt>
            <dd>{fmtNum(picked.slopeDeg, '°')}</dd>
          </dl>
          <p className="small muted">
            Summary value for {periodLabel} (UTC), not a time series. The mission simulation runs only at the listed sites. Cells every {spacingM} m; terrain horizon computed for each
            cell from the LOLA DEMs.
          </p>
        </div>
      </div>
      {map.warnings && map.warnings.length > 0 && (
        <ul className="small muted sitemap__warnings">
          {map.warnings.map((w) => (
            <li key={w}>Data note: {w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
