/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseScientificPackage, PACKAGE_FILES } from './scientificPackage.ts'
import { DEFAULT_SETTINGS, evaluateScenario } from '../sim/evaluate.ts'

const root = new URL('../../public/data/packages/ConnectingRidge2026to2029/', import.meta.url)
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer
function fixture(folder = root) {
  return Object.fromEntries(['package.json', ...PACKAGE_FILES].map(n => [n, new Uint8Array(readFileSync(new URL(n, folder))).buffer]))
}
function rewrite(f: Record<string, ArrayBuffer>, name: string, update: (d: any) => void) {
  const d = JSON.parse(new TextDecoder().decode(f[name]))
  update(d)
  f[name] = bytes(JSON.stringify(d))
  if (name !== 'package.json') {
    rewrite(f, 'package.json', m => { m.files[name] = { bytes: f[name].byteLength, sha256: createHash('sha256').update(new Uint8Array(f[name])).digest('hex') } })
  }
}

describe('scientific package import boundary', () => {
  it('imports a real free-coordinate global package at the longitude seam across leap day', async () => {
    const p = await parseScientificPackage(fixture(new URL('../../public/data/packages/GlobalSeamExample/', import.meta.url)))
    expect(p.data.site.lonDeg).toBe(180)
    expect(p.data.site.demNear).toMatch(/LDEM_64/)
    expect(p.data.ephemeris.startUtc).toBe('2028-02-29T00:00:00Z')
    expect(p.data.ephemeris.count).toBe(145)
    expect(p.manifest.warnings.join(' ')).toMatch(/474/)
  })
  it('loads real multi-year data with its own coordinate, observer, coverage and hash', async () => {
    const p = await parseScientificPackage(fixture())
    expect(p.manifest.coverage.endUtc).toBe('2029-11-01T00:00:00Z')
    expect(p.data.ephemeris.count).toBe(p.manifest.coverage.count)
    expect(p.data.provenance?.eyeM).toBe(p.data.site.surfaceElevationM + 2)
    expect(p.data.provenance?.dataHash).toBe(p.header.year.sha256)
    expect(p.data.site.category).toBe('custom')
  })
  it('rejects a changed binary before parsing it', async () => {
    const f = fixture(); new Uint8Array(f['year.bin'])[100] ^= 1
    await expect(parseScientificPackage(f)).rejects.toThrow(/year.bin: sha256 mismatch/)
  })
  it('accepts the last valid mission and rejects a step beyond the actual package end', async () => {
    const { data } = await parseScientificPackage(fixture())
    const settings = { ...DEFAULT_SETTINGS, durationDays: 1 }
    expect(() => evaluateScenario(data, '2029-10-31T00:00:00Z', settings)).not.toThrow()
    expect(() => evaluateScenario(data, '2029-10-31T00:10:00Z', settings)).toThrow(/2029-11-01/)
  })
  it('rejects missing scientific files', async () => {
    const f = fixture(); delete f['horizon.json']
    await expect(parseScientificPackage(f)).rejects.toThrow(/horizon.json/)
  })
  it('rejects inconsistent observer even when the replacement file hash is correct', async () => {
    const f = fixture(); rewrite(f, 'site.json', d => { d.observerHeightM = 3 })
    await expect(parseScientificPackage(f)).rejects.toThrow(/observer differs/)
  })
  it('rejects a horizon made for another eye', async () => {
    const f = fixture(); rewrite(f, 'horizon.json', d => { d.observer.eyeM += 1 })
    await expect(parseScientificPackage(f)).rejects.toThrow(/horizon observer differs/)
  })
  it('rejects inconsistent time coverage', async () => {
    const f = fixture(); rewrite(f, 'package.json', m => { m.coverage.endUtc = '2030-11-01T00:00:00Z' })
    await expect(parseScientificPackage(f)).rejects.toThrow(/coverage.endUtc/)
  })
  it('rejects a main series inconsistent with its binary even if all hashes are correct', async () => {
    const f = fixture(); rewrite(f, 'ephemeris.json', e => { e.sun.elDeg[0] += 1 })
    await expect(parseScientificPackage(f)).rejects.toThrow(/main ephemeris differs/)
  })
  it('accepts a valid observer regardless of JSON field order', async () => {
    const f = fixture(); rewrite(f, 'package.json', m => { const o = m.observer; m.observer = { eyeM: o.eyeM, lonDeg: o.lonDeg, latDeg: o.latDeg } })
    await expect(parseScientificPackage(f)).resolves.toHaveProperty('data.site.id')
  })
})
