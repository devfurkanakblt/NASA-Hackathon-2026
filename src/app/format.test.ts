import { describe, expect, it } from 'vitest'
import { fmtDuration, fmtHours, fmtKWh, fmtPct, fmtUtc, fromInputUtc, shiftUtc, toInputUtc } from './format.ts'

describe('display helpers', () => {
  it('formats durations, hours, percentages and energy', () => {
    expect(fmtDuration(0)).toBe('0 min')
    expect(fmtDuration(90 * 60)).toBe('1 h 30 min')
    expect(fmtDuration(7 * 86400)).toBe('7 d')
    expect(fmtDuration(86400 + 3 * 3600)).toBe('1 d 3 h')
    expect(fmtHours(47 * 3600)).toBe('47 h')
    expect(fmtPct(0.835)).toBe('83.5 %')
    expect(fmtPct(1)).toBe('100 %')
    expect(fmtKWh(3.6e6)).toBe('1.0 kWh')
  })

  it('reads and writes the date field as UTC, whatever the browser time zone', () => {
    expect(toInputUtc('2026-11-15T03:00:00+03:00')).toBe('2026-11-15T00:00')
    expect(fromInputUtc('2026-11-15T00:00')).toBe('2026-11-15T00:00:00Z')
    expect(fromInputUtc('')).toBeNull()
    expect(fromInputUtc('2026-02-30T00:00')).toBeNull()
    expect(fmtUtc('2026-11-18T00:00:00Z')).toBe('2026-11-18 00:00 UTC')
    expect(shiftUtc('2026-11-15T00:00:00Z', 72)).toBe('2026-11-18T00:00:00Z')
  })
})
