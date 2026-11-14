// Public surface of the 3D mission view. Import from here, not from the files inside.
// This module (src/scene3d) was written with AI assistance (Anthropic Claude) — see the project's AI-use statement.
// Nothing exported from this file pulls three.js into the main bundle.
export { MissionScene3D } from './MissionScene3D.tsx'
export { isWebGLAvailable } from './webgl.ts'
export type { MissionScene3DProps } from './SceneCanvas.tsx'
export type { BodyPath, BodyState, BodyStatus, CameraMode, HorizonProfile, PanelMode, PanelState, TerrainGrid } from './types.ts'
export { OBSERVER_HEIGHT_M, azElToUnitVector, bodyStatus, horizonElevationAt } from './coords.ts'
