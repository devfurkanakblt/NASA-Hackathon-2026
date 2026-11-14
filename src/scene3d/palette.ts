import type { BodyStatus } from './types.ts'

export const SUN_COLOR = '#ffd34d'
export const EARTH_COLOR = '#4da3ff'
export const NORTH_COLOR = '#ff5a4f'
export const TERRAIN_HORIZON_COLOR = '#ff9f43'
export const GEOMETRIC_HORIZON_COLOR = '#cfd6e4'

/** Accent used for a body that is not in view; `null` keeps the body's own colour. */
export const STATUS_COLOR: Record<BodyStatus, string | null> = {
  visible: null,
  'terrain-blocked': TERRAIN_HORIZON_COLOR,
  'below-horizon': '#8a93a3',
}

export const STATUS_TEXT: Record<BodyStatus, string> = {
  visible: 'visible',
  'terrain-blocked': 'behind terrain',
  'below-horizon': 'below horizon',
}
