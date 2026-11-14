import type { EarthOrientationDoc, EphemerisDoc, HorizonDoc, SiteEntry, SitesDoc, TerrainDoc } from './contract.ts'

export const TERRAIN_FRAME = 'local ENU, origin at observer eye; x = east, y = north, z = up'
export const EARTH_TEXTURE_FRAME = 'Three sphere: +X=ITRS Greenwich/equator, +Y=ITRS north pole, +Z=-ITRS 90E/equator; u=0 at longitude -180, u=0.5 at 0'

export class DataValidationError extends Error {}

function fail(source: string, path: string, expected: string): never {
  throw new DataValidationError(`${source}: invalid ${path}; expected ${expected}`)
}

function record(value: unknown, source: string, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(source, path, 'an object')
  return value as Record<string, unknown>
}

function string(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(source, path, 'a non-empty string')
  return value
}

function number(value: unknown, source: string, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(source, path, `a finite number in [${min}, ${max}]`)
  return value
}

function integer(value: unknown, source: string, path: string, min: number): number {
  const n = number(value, source, path, min)
  if (!Number.isSafeInteger(n)) fail(source, path, `an integer >= ${min}`)
  return n
}

function strings(value: unknown, source: string, path: string): void {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) fail(source, path, 'an array of strings')
}

function numbers(value: unknown, length: number, source: string, path: string, min = -Infinity, max = Infinity, exclusiveMax = false): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(source, path, `an array of ${length} numbers`)
  value.forEach((x, i) => {
    number(x, source, `${path}[${i}]`, min, max)
    if (exclusiveMax && x === max) fail(source, `${path}[${i}]`, `a value < ${max}`)
  })
  return value as number[]
}

function utc(value: unknown, source: string, path: string): number {
  const s = string(value, source, path)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) fail(source, path, 'an ISO UTC instant ending in Z')
  const ms = Date.parse(s)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== s.slice(0, 19)) fail(source, path, 'a valid UTC calendar date')
  return ms
}

function version(doc: Record<string, unknown>, source: string): void {
  if (doc.version !== 1) fail(source, 'version', 'supported version 1')
}

function siteId(doc: Record<string, unknown>, expected: string, source: string): void {
  if (doc.siteId !== expected) fail(source, 'siteId', expected)
}

export function validateSites(value: unknown, source = 'sites.json'): SitesDoc {
  const doc = record(value, source, 'document')
  version(doc, source)
  const coverage = record(doc.coverage, source, 'coverage')
  const start = utc(coverage.startUtc, source, 'coverage.startUtc')
  const end = utc(coverage.endUtc, source, 'coverage.endUtc')
  const step = integer(coverage.stepS, source, 'coverage.stepS', 1)
  const steps = (end - start) / (step * 1000)
  if (steps < 1 || Math.abs(steps - Math.round(steps)) > 1e-8) fail(source, 'coverage', 'an increasing whole-step time range')
  if (!Array.isArray(doc.sites) || doc.sites.length === 0) fail(source, 'sites', 'a non-empty site list')
  const seen = new Set<string>()
  doc.sites.forEach((entry, i) => {
    const s = record(entry, source, `sites[${i}]`)
    const id = string(s.id, source, `sites[${i}].id`)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || seen.has(id)) fail(source, `sites[${i}].id`, 'a unique safe site identifier')
    seen.add(id)
    for (const key of ['name', 'coordSource', 'demNear', 'demFar', 'label']) string(s[key], source, `${id}.${key}`)
    number(s.latDeg, source, `${id}.latDeg`, -90, 90)
    const lon = number(s.lonDeg, source, `${id}.lonDeg`, -180, 180)
    if (lon === -180) fail(source, `${id}.lonDeg`, 'east longitude in (-180, 180]')
    number(s.surfaceElevationM, source, `${id}.surfaceElevationM`)
    number(s.observerHeightM, source, `${id}.observerHeightM`, 0)
    strings(s.warnings, source, `${id}.warnings`)
    if (s.derivedFrom !== undefined) string(s.derivedFrom, source, `${id}.derivedFrom`)
    if (s.derivation !== undefined) string(s.derivation, source, `${id}.derivation`)
  })
  return value as SitesDoc
}

export function validateEphemeris(value: unknown, site: SiteEntry, coverage: SitesDoc['coverage'], source = 'ephemeris.json'): EphemerisDoc {
  const doc = record(value, source, 'document')
  version(doc, source)
  siteId(doc, site.id, source)
  if (doc.source !== 'jpl-horizons' && doc.source !== 'skyfield-de421') fail(source, 'source', 'jpl-horizons or skyfield-de421 scientific data')
  const start = utc(doc.startUtc, source, 'startUtc')
  const step = integer(doc.stepS, source, 'stepS', 1)
  const count = integer(doc.count, source, 'count', 2)
  if (start !== Date.parse(coverage.startUtc) || step !== coverage.stepS || start + (count - 1) * step * 1000 !== Date.parse(coverage.endUtc)) fail(source, 'time grid', 'the catalogue coverage, step and inclusive final endpoint')
  const settings = record(doc.settings, source, 'settings')
  if (settings.center !== 'coord@301' || settings.frame !== 'MOON_ME' || settings.refraction !== false) fail(source, 'settings', 'coord@301, MOON_ME, refraction=false')
  if (number(settings.observerHeightM, source, 'settings.observerHeightM', 0) !== site.observerHeightM) fail(source, 'settings.observerHeightM', 'the catalogue observer height')
  utc(doc.generatedUtc, source, 'generatedUtc')
  for (const body of ['sun', 'earth']) {
    const series = record(doc[body], source, body)
    numbers(series.azDeg, count, source, `${body}.azDeg`, 0, 360, true)
    numbers(series.elDeg, count, source, `${body}.elDeg`, -90, 90)
    const distance = numbers(series.distanceM, count, source, `${body}.distanceM`, 0)
    if (distance.some((x) => x <= 0)) fail(source, `${body}.distanceM`, 'strictly positive distances in metres')
  }
  return value as EphemerisDoc
}

export function validateHorizon(value: unknown, expectedSite: string, source = 'horizon.json'): HorizonDoc {
  const doc = record(value, source, 'document')
  version(doc, source)
  siteId(doc, expectedSite, source)
  const count = integer(doc.count, source, 'count', 2)
  const step = number(doc.azStepDeg, source, 'azStepDeg', Number.MIN_VALUE, 180)
  if (Math.abs(count * step - 360) > 1e-6) fail(source, 'angular grid', 'count * azStepDeg = 360 with no duplicate endpoint')
  numbers(doc.elevDeg, count, source, 'elevDeg', -90, 90)
  const params = record(doc.params, source, 'params')
  const minRange = number(params.minRangeM, source, 'params.minRangeM', 0)
  const nearRange = number(params.nearRangeM, source, 'params.nearRangeM', minRange)
  const maxRange = number(params.maxRangeM, source, 'params.maxRangeM', nearRange)
  number(params.nearStepM, source, 'params.nearStepM', Number.MIN_VALUE)
  number(params.farStepM, source, 'params.farStepM', Number.MIN_VALUE)
  if (params.curvature !== true) fail(source, 'params.curvature', 'true (spherical curvature included)')
  numbers(doc.distanceM, count, source, 'distanceM', 0, maxRange + 1)
  strings(doc.warnings, source, 'warnings')
  return value as HorizonDoc
}

export function validateTerrain(value: unknown, expectedSite: string, source = 'terrain.json'): TerrainDoc {
  const doc = record(value, source, 'document')
  version(doc, source)
  siteId(doc, expectedSite, source)
  if (doc.frame !== TERRAIN_FRAME) fail(source, 'frame', TERRAIN_FRAME)
  const n = integer(doc.n, source, 'n', 2)
  const size = number(doc.sizeM, source, 'sizeM', Number.MIN_VALUE)
  const cell = number(doc.cellM, source, 'cellM', Number.MIN_VALUE)
  // v1 cells are means at cell centres, not samples on the outer patch vertices.
  const expected = size / n
  if (Math.abs(cell - expected) > Math.max(0.001, expected * 1e-4)) fail(source, 'cellM', 'cell-centre spacing sizeM/n')
  numbers(doc.zM, n * n, source, 'zM')
  return value as TerrainDoc
}

export function validateEarthOrientation(value: unknown, expectedSite: string, ephemeris: EphemerisDoc, source = 'earth-orientation.json', site?: SiteEntry): EarthOrientationDoc {
  const doc = record(value, source, 'document')
  version(doc, source)
  siteId(doc, expectedSite, source)
  const start = utc(doc.startUtc, source, 'startUtc')
  const step = integer(doc.stepS, source, 'stepS', 1)
  const count = integer(doc.count, source, 'count', 2)
  if (start !== Date.parse(ephemeris.startUtc) || step !== ephemeris.stepS || count !== ephemeris.count) fail(source, 'time grid', 'the scientific ephemeris time grid')
  if (!Array.isArray(doc.quaternionXyzw) || doc.quaternionXyzw.length !== count) fail(source, 'quaternionXyzw', `${count} unit quaternions`)
  doc.quaternionXyzw.forEach((entry, i) => {
    const q = numbers(entry, 4, source, `quaternionXyzw[${i}]`, -1.000001, 1.000001)
    if (Math.abs(Math.hypot(...q) - 1) > 1e-3) fail(source, `quaternionXyzw[${i}]`, 'a unit quaternion (norm tolerance 0.001)')
  })
  if (doc.sunDirectionAtEarth !== undefined) {
    if (!Array.isArray(doc.sunDirectionAtEarth) || doc.sunDirectionAtEarth.length !== count) fail(source, 'sunDirectionAtEarth', `${count} unit vectors`)
    doc.sunDirectionAtEarth.forEach((entry, i) => {
      const direction = numbers(entry, 3, source, `sunDirectionAtEarth[${i}]`, -1.000001, 1.000001)
      if (Math.abs(Math.hypot(...direction) - 1) > 1e-3) fail(source, `sunDirectionAtEarth[${i}]`, 'a unit vector (norm tolerance 0.001)')
    })
  }
  const provenance = record(doc.source, source, 'source')
  string(provenance.method, source, 'source.method')
  if (provenance.textureBodyFrame !== EARTH_TEXTURE_FRAME) fail(source, 'source.textureBodyFrame', EARTH_TEXTURE_FRAME)
  if (site) {
    const location = record(provenance.site, source, 'source.site')
    for (const [key, expected] of Object.entries({ latitudeDeg: site.latDeg, longitudeDeg: site.lonDeg,
      surfaceElevationM: site.surfaceElevationM, observerHeightM: site.observerHeightM })) {
      if (location[key] !== expected) fail(source, `source.site.${key}`, 'the current catalogue coordinate and observer')
    }
  }
  return value as EarthOrientationDoc
}
