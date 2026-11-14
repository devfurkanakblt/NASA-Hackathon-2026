/// <reference types="node" />
/**
 * Acceptance check from the plan (§5 "Performans"): after the first load the app makes no
 * network requests, and the browser never talks to the JPL API. The only network code in the
 * app is `loadAllData()` in src/data/load.ts, which runs once at start-up.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('network use in the app', () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }))

  it('fetches only in the data loader', () => {
    const network = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|navigator\.sendBeacon/
    expect(files.filter((f) => network.test(f.text)).map((f) => f.path)).toEqual(['data/load.ts'])
  })

  it('never addresses an outside host (no JPL / NASA API calls from the browser)', () => {
    const outside = /['"`]https?:\/\//
    expect(files.filter((f) => outside.test(f.text)).map((f) => f.path)).toEqual([])
  })

  it('loads the data once, when the app starts', () => {
    const callers = files.filter((f) => /\bloadAllData\s*\(/.test(f.text) && f.path !== 'data/load.ts').map((f) => f.path)
    for (const path of callers) {
      const text = files.find((f) => f.path === path)!.text
      // The call sits in a mount-only effect: useEffect(..., []).
      expect(text).toMatch(/useEffect\(\(\) => \{[\s\S]*?loadAllData\(\)[\s\S]*?\}, \[\]\)/)
    }
    expect(callers.length).toBeGreaterThan(0)
  })
})
