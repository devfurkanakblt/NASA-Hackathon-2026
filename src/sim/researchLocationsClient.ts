import { findResearchLocations, type ResearchLocationsInput, type ResearchLocationsResult } from './researchLocations.ts'
import type { SearchOptions } from './search.ts'
import type { ResearchWorkerOut } from './researchLocations.worker.ts'

export function runResearchLocations(input: ResearchLocationsInput, opts: Pick<SearchOptions, 'signal' | 'onProgress'> = {}): Promise<ResearchLocationsResult> {
  if (opts.signal?.aborted) return Promise.reject(new DOMException('Search cancelled.', 'AbortError'))
  if (typeof Worker === 'undefined') return findResearchLocations(input, opts)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./researchLocations.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); opts.signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Search cancelled.', 'AbortError')) }
    worker.onmessage = (e: MessageEvent<ResearchWorkerOut>) => {
      if (e.data.type === 'progress') opts.onProgress?.(e.data.done, e.data.planned)
      else if (e.data.type === 'result') { cleanup(); resolve(e.data.result) }
      else { cleanup(); reject(new Error(e.data.message)) }
    }
    worker.onerror = e => { cleanup(); reject(new Error(e.message || 'Research search failed.')) }
    opts.signal?.addEventListener('abort', abort, { once: true })
    worker.postMessage(input)
  })
}
