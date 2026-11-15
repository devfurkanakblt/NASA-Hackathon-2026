import { findResearchLocations, type ResearchLocationsInput, type ResearchLocationsResult } from './researchLocations.ts'

export type ResearchWorkerOut = { type: 'progress'; done: number; planned: number } | { type: 'result'; result: ResearchLocationsResult } | { type: 'error'; message: string }
const scope = self as unknown as { onmessage: ((e: MessageEvent<ResearchLocationsInput>) => void) | null; postMessage: (m: ResearchWorkerOut) => void }
scope.onmessage = e => {
  findResearchLocations(e.data, { onProgress: (done, planned) => scope.postMessage({ type: 'progress', done, planned }) })
    .then(result => scope.postMessage({ type: 'result', result }))
    .catch((error: unknown) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
}
