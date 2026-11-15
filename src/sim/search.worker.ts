import { runSearchRequest, type SearchRequest } from './searchRequest.ts'

export type WorkerIn = { type: 'run'; request: SearchRequest } | { type: 'cancel' }
export type WorkerOut =
  | { type: 'progress'; done: number; planned: number }
  | { type: 'result'; result: Awaited<ReturnType<typeof runSearchRequest>> }
  | { type: 'error'; message: string; issues?: string[] }

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerIn>) => void) | null; postMessage: (m: WorkerOut) => void }
const controller = new AbortController()

scope.onmessage = (e) => {
  if (e.data.type === 'cancel') {
    controller.abort()
    return
  }
  runSearchRequest(e.data.request, { signal: controller.signal, onProgress: (done, planned) => scope.postMessage({ type: 'progress', done, planned }) })
    .then((result) => scope.postMessage({ type: 'result', result }))
    .catch((err: unknown) => scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), issues: (err as { issues?: string[] })?.issues }))
}
