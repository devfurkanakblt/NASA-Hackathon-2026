import type { LunarImageryDoc, SiteEntry } from './contract.ts'

/** Validate identity and georegistration before a photograph can be placed on the terrain. */
export function validateLunarImagery(value: unknown, site: SiteEntry, sizeM: number, far: boolean, source: string): LunarImageryDoc {
  const fail = (field: string): never => { throw new Error(`${source}: invalid lunar imagery ${field}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('document')
  const d = value as LunarImageryDoc
  if (d.version !== 1 || d.siteId !== site.id) fail('version/siteId')
  const stem = far ? 'lunar-imagery-far' : 'lunar-imagery'
  if (![`${stem}.jpg`, `${stem}.png`].includes(d.file) || d.frame !== 'local-east-north-metres-image-north-up') fail('file/frame')
  if (!Number.isFinite(d.sizeM) || Math.abs(d.sizeM - sizeM) > 0.001) fail('footprint')
  if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 16 || d.width > 8192 || d.width !== d.height) fail('dimensions')
  if (d.archiveShadows !== true || !/^[0-9a-f]{64}$/.test(d.sha256 ?? '')) fail('archive/hash')
  const s = d.source
  if (!s || typeof s.url !== 'string' || !/^https:\/\//.test(s.url) || typeof s.name !== 'string' || !s.name ||
      !Number.isFinite(s.nativePixelM) || s.nativePixelM <= 0 || typeof s.acquisition !== 'string' || !s.acquisition ||
      typeof s.crs !== 'string' || !s.crs || !Array.isArray(s.transform) || s.transform.length !== 6 || !s.transform.every(Number.isFinite) ||
      typeof s.resampling !== 'string' || !s.resampling || !Array.isArray(s.limitations) || !s.limitations.every(v => typeof v === 'string')) fail('provenance')
  const p = s.site
  if (!p || p.latitudeDeg !== site.latDeg || p.longitudeDeg !== site.lonDeg ||
      p.surfaceElevationM !== site.surfaceElevationM || p.observerHeightM !== site.observerHeightM) fail('observer coordinate')
  return d
}
