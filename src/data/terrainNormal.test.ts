/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SitesDoc } from './contract.ts'
import { validateTerrainNormal } from './terrainNormal.ts'

const directory = fileURLToPath(new URL('../../public/data/', import.meta.url))
const catalogue = JSON.parse(readFileSync(`${directory}sites.json`, 'utf8')) as SitesDoc

describe('published measured surface detail', () => {
  for (const site of catalogue.sites.filter(s => s.category !== 'contrast' && !s.program)) {
    it(`${site.id}: registers the measured footprint and verifies the exact PNG bytes`, () => {
      const terrain = JSON.parse(readFileSync(`${directory}${site.id}/terrain.json`, 'utf8'))
      const manifest = validateTerrainNormal(JSON.parse(readFileSync(`${directory}${site.id}/terrain-normal.json`, 'utf8')), site, terrain.sizeM, site.id)
      const png = readFileSync(`${directory}${site.id}/${manifest.file}`)
      expect(createHash('sha256').update(png).digest('hex')).toBe(manifest.sha256)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(png.readUInt32BE(16)).toBe(manifest.n)
      expect(png.readUInt32BE(20)).toBe(manifest.n)
      expect(manifest.sizeM).toBeLessThanOrEqual(terrain.sizeM)
      expect(manifest.sourceNativePixelM).toBe(5)
    })
  }
  it('does not imply that the comparison sites have native fine surface data', () => {
    for (const site of catalogue.sites.filter(s => s.category === 'contrast')) {
      expect(existsSync(`${directory}${site.id}/terrain-normal.json`)).toBe(false)
      expect(existsSync(`${directory}${site.id}/terrain-normal.png`)).toBe(false)
    }
  })
})
