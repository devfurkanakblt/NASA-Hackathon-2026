/**
 * Runs a search off the UI thread (one Worker per search; cancelling terminates it after the
 * worker has answered with its partial result). Without Worker support the same request runs on
 * the main thread in yielding chunks. Pair with `latestSearch()` so an old search never
 * overwrites the result for new settings.
 *
 *   const run = latestSearch()
 *   const result = await run((signal) => runSearch(request, { signal, onProgress }))
 *   if (result) show(result) // null: superseded
 */
import { SettingsError } from './evaluate.ts'
import type { SearchOptions, SearchResult } from './search.ts'
import type { WorkerIn, WorkerOut } from './search.worker.ts'
import { runSearchRequest, type SearchRequest } from './searchRequest.ts'

export function runSearch(request: SearchRequest, opts: Pick<SearchOptions, 'signal' | 'onProgress'> = {}): Promise<SearchResult> {
  if (typeof Worker === 'undefined') return runSearchRequest(request, opts)
  return new Promise<SearchResult>((resolve, reject) => {
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    const post = (m: WorkerIn) => worker.postMessage(m)
    const onAbort = () => post({ type: 'cancel' })
    const done = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') opts.onProgress?.(m.done, m.planned)
      else if (m.type === 'result') {
        done()
        resolve(m.result)
      } else {
        done()
        reject(m.issues ? new SettingsError(m.issues) : new Error(m.message))
      }
    }
    worker.onerror = (e) => {
      done()
      reject(new Error(e.message || 'Search worker failed.'))
    }
    opts.signal?.addEventListener('abort', onAbort)
    post({ type: 'run', request })
    if (opts.signal?.aborted) onAbort()
  })
}
