/** Display helpers. The engine works in SI units (s, W, J); the screen shows h, kWh and %. */
import { J_PER_WH } from '../sim/energy.ts'

export function fmtDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}

/** Hours with one decimal at most: 47 h, 157.5 h. */
export function fmtHours(seconds: number): string {
  return `${Math.round((seconds / 3600) * 10) / 10} h`
}

/** 0.835 → "83.5 %", 1 → "100 %". */
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10} %`
}

export function fmtKWh(joules: number): string {
  return `${(joules / J_PER_WH / 1000).toFixed(1)} kWh`
}

/** "2026-11-15 00:00 UTC" */
export function fmtUtc(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs)
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

/** ISO UTC → value for <input type="datetime-local"> read as UTC ("2026-11-15T00:00"). */
export function toInputUtc(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 16)
}

/** Value of <input type="datetime-local"> read as UTC → ISO UTC, or null when empty/invalid. */
export function fromInputUtc(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const ms = Date.UTC(y, mo - 1, d, h, mi)
  const back = new Date(ms)
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null
  return isoUtc(ms)
}

export function shiftUtc(iso: string, hours: number): string {
  return isoUtc(Date.parse(iso) + hours * 3600 * 1000)
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
