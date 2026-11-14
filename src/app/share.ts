/**
 * Shareable link: the comparison (scenarios, active scenario, mission hardware) lives in the URL
 * fragment, e.g. `#s=Site04@2026-11-15T00:00,Site04R@2026-11-15T00:00&a=B&set=durationDays:10`.
 * Only settings that differ from the defaults are written. The fragment never reaches a server,
 * so sharing a link sends nothing anywhere; anything unreadable in it is ignored.
 */
import { DEFAULT_SETTINGS, MAX_SCENARIOS } from '../sim/evaluate.ts'
import type { MissionSettings } from '../sim/evaluate.ts'
import { fromInputUtc, toInputUtc } from './format.ts'
import { LETTERS, newKey } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'

export interface SharedState {
  scenarios: Scenario[]
  /** Index of the active scenario. */
  active: number
  settings: MissionSettings
}

type Key = keyof MissionSettings
const KEYS = Object.keys(DEFAULT_SETTINGS) as Key[]
const TEXT_VALUES: Partial<Record<Key, readonly string[]>> = { panelMode: ['tracking', 'fixed'], sunDiskModel: ['centre', 'partial'] }

export function encodeShare({ scenarios, active, settings }: SharedState): string {
  const parts = [`s=${scenarios.map((s) => `${encodeURIComponent(s.siteId)}@${toInputUtc(s.startUtc)}`).join(',')}`]
  if (active > 0) parts.push(`a=${LETTERS[active]}`)
  const changed = KEYS.filter((key) => settings[key] !== undefined && settings[key] !== DEFAULT_SETTINGS[key])
  if (changed.length) parts.push(`set=${changed.map((key) => `${key}:${encodeURIComponent(String(settings[key]))}`).join(',')}`)
  return `#${parts.join('&')}`
}

/** Reads a fragment written by `encodeShare`. Returns null when it holds no usable scenario. */
export function decodeShare(hash: string, siteIds: string[]): SharedState | null {
  const params = new Map<string, string>()
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=')
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1))
  }
  const scenarios: Scenario[] = []
  for (const item of (params.get('s') ?? '').split(',')) {
    const at = item.lastIndexOf('@')
    if (at <= 0) continue
    const siteId = safeDecode(item.slice(0, at))
    const startUtc = fromInputUtc(safeDecode(item.slice(at + 1)))
    if (siteId && siteIds.includes(siteId) && startUtc && scenarios.length < MAX_SCENARIOS) scenarios.push({ key: newKey(), siteId, startUtc })
  }
  if (scenarios.length === 0) return null

  const settings: MissionSettings = { ...DEFAULT_SETTINGS }
  const writable = settings as unknown as Record<string, unknown>
  for (const item of (params.get('set') ?? '').split(',')) {
    const colon = item.indexOf(':')
    const key = item.slice(0, colon) as Key
    if (colon <= 0 || !KEYS.includes(key)) continue
    const raw = safeDecode(item.slice(colon + 1))
    const allowed = TEXT_VALUES[key]
    if (allowed) {
      if (allowed.includes(raw)) writable[key] = raw
    } else if (raw.trim() !== '' && Number.isFinite(Number(raw))) writable[key] = Number(raw)
  }
  const letter = LETTERS.indexOf((params.get('a') ?? 'A') as (typeof LETTERS)[number])
  return { scenarios, active: Math.min(Math.max(0, letter), scenarios.length - 1), settings }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return ''
  }
}
