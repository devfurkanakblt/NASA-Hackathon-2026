import type { SiteEntry, TerrainNormalDoc } from './contract.ts'

const FRAME = 'Three object normal (+east,+up,-north)'
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** Display detail is accepted only for the current observer and the stated linear object frame. */
export function validateTerrainNormal(value: unknown, site: SiteEntry, sizeM: number, source: string): TerrainNormalDoc {
  const fail = (field: string): never => { throw new Error(`${source}: invalid terrain normal ${field}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('document')
  const d = value as TerrainNormalDoc
  if (d.version !== 1 || d.siteId !== site.id) fail('version/siteId')
  if (d.file !== 'terrain-normal.png' || d.frame !== FRAME) fail('file/frame')
  if (!positive(d.sizeM) || d.sizeM > sizeM || !Number.isInteger(d.n) || d.n < 16 || d.n > 2048) fail('footprint')
  if (!positive(d.outputPixelM) || Math.abs(d.outputPixelM - d.sizeM / d.n) > 1e-6) fail('pixel spacing')
  if (!positive(d.sourceNativePixelM) || d.sourceNativePixelM > d.outputPixelM) fail('native resolution')
  if (!hash(d.sha256) || !d.source || !hash(d.source.sha256)) fail('source hashes')
  if (typeof d.source.url !== 'string' || !d.source.url || typeof d.source.method !== 'string' || !d.source.method) fail('source provenance')
  const location = d.source.site
  if (!location || location.latitudeDeg !== site.latDeg || location.longitudeDeg !== site.lonDeg ||
      location.surfaceElevationM !== site.surfaceElevationM || location.observerHeightM !== site.observerHeightM) fail('observer coordinate')
  return d
}
