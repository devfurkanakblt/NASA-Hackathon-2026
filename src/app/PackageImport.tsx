import { useEffect, useRef, useState } from 'react'
import type { SiteData } from '../data/contract.ts'
import { AbortError, fetchPackageIndex, fetchScientificPackage, filesFromUpload, type PackageIndexEntry } from '../data/packageService.ts'
import { parseScientificPackage, type ScientificPackage } from '../data/scientificPackage.ts'
import { errorMessage } from './format.ts'

interface Props {
  bySite: Record<string, SiteData>
  /** Adds the validated package to the site table and to the chosen places. Returns the message to show. */
  onPackage: (pkg: ScientificPackage) => { ok: boolean; text: string }
}

/**
 * Opens a scientific package (A's format) without changing the catalogue: a published one from
 * `packages.json` that is not already a catalogue site (e.g. the 2026–2029 multi-year series), or a
 * folder the user generated with `python -m preprocess.custom_point`. Every file is checked
 * (hashes, observer, coverage, values) before anything is added.
 */
export function PackageImport({ bySite, onPackage }: Props) {
  const [index, setIndex] = useState<PackageIndexEntry[] | 'error' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const open = () => {
    if (index === null) fetchPackageIndex().then(setIndex, () => setIndex('error'))
  }
  const extra = Array.isArray(index) ? index.filter((p) => !(p.siteId in bySite) || bySite[p.siteId]?.site.category === 'custom') : []

  const run = async (label: string, get: (signal: AbortSignal) => Promise<ScientificPackage>) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setMsg(null)
    setBusy(label)
    try {
      setMsg(onPackage(await get(ctl.signal)))
    } catch (e) {
      setMsg({ ok: false, text: e instanceof AbortError ? 'Cancelled.' : `Not imported: ${errorMessage(e)}` })
    } finally {
      if (abort.current === ctl) {
        abort.current = null
        setBusy(null)
      }
    }
  }

  return (
    <details className="moon-picker__coords package-import" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) open() }}>
      <summary>
        <span className="moon-picker__coords-icon" aria-hidden="true">⇪</span>
        <span>Open a data package</span>
        <span className="moon-picker__coords-hint">multi-year or your own point</span>
      </summary>
      <div className="coordinate-form">
        <p className="small muted">A package holds one point’s terrain horizon and Sun / Earth series for its own period. It is checked file by file before use and never replaces a catalogue site.</p>
        {index === 'error' && <p className="small bad">The list of published packages could not be loaded.</p>}
        {extra.length > 0 && (
          <div className="package-import__list">
            {extra.map((p) => (
              <button key={p.siteId} type="button" disabled={!!busy} onClick={() => run(p.siteId, (signal) => fetchScientificPackage(p, undefined, { signal }))}>
                {p.siteId} · {p.coverage.startUtc.slice(0, 10)} to {p.coverage.endUtc.slice(0, 10)}
              </button>
            ))}
          </div>
        )}
        <label className="package-import__folder">
          <span>Or choose a package folder (from python -m preprocess.custom_point)</span>
          <input
            type="file"
            multiple
            // A folder picker where supported; selecting the seven files works everywhere.
            {...{ webkitdirectory: '' }}
            disabled={!!busy}
            onChange={(e) => {
              const files = e.currentTarget.files
              if (files && files.length) run('folder', async () => parseScientificPackage(await filesFromUpload(files)))
              e.currentTarget.value = ''
            }}
          />
        </label>
        {busy && (
          <p className="small" role="status">
            Checking {busy}… <button type="button" onClick={() => abort.current?.abort()}>Cancel</button>
          </p>
        )}
        {msg && <p className={`small ${msg.ok ? 'muted' : 'bad'}`} role="status">{msg.text}</p>}
      </div>
    </details>
  )
}
