import { Component, Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import type { MissionScene3DProps as RequiredSceneProps } from './SceneCanvas.tsx'
import type { TerrainGrid } from './types.ts'
import './scene3d.css'
import { isWebGLAvailable } from './webgl.ts'

// three.js and the scene are a separate chunk: the rest of the app loads and works without them.
const SceneCanvas = lazy(() => import('./SceneCanvas.tsx'))

export type MissionScene3DProps = Omit<RequiredSceneProps, 'terrain'> & { terrain?: TerrainGrid }

function SceneFallback({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div className="scene3d scene3d--fallback" role="status">
      <strong>3D view unavailable</strong>
      <p>{reason}</p>
      <p>The horizon panorama, timelines and scenario comparison do not depend on it and keep working.</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

class SceneErrorBoundary extends Component<{ children: ReactNode; resetKey: TerrainGrid }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[scene3d] 3D view failed:', error)
  }

  componentDidUpdate(previous: { resetKey: TerrainGrid }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error) {
      return <SceneFallback reason={error.message || 'The 3D scene could not be drawn.'} onRetry={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}

/**
 * 3D mission view. Safe to drop anywhere: if WebGL is missing, the chunk fails to load,
 * or the scene throws, it shows a notice in its own box and the rest of the app carries on.
 */
export function MissionScene3D(props: MissionScene3DProps) {
  if (!props.terrain) {
    return <SceneFallback reason="The local visual terrain is unavailable. Scientific horizon and ephemeris data remain usable." />
  }
  if (!isWebGLAvailable()) {
    return <SceneFallback reason="This browser or device cannot create a WebGL context." />
  }
  return (
    <SceneErrorBoundary resetKey={props.terrain}>
      <Suspense fallback={<div className="scene3d scene3d--loading">Loading 3D view…</div>}>
        <SceneCanvas {...props} terrain={props.terrain} />
      </Suspense>
    </SceneErrorBoundary>
  )
}
