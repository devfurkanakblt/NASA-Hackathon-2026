import { describe, expect, it } from 'vitest'
import { latestMissionStartUtc } from './missionDates.ts'
import { fromInputUtc, shiftUtc, toInputUtc } from '../app/format.ts'

describe('simulation UTC date controls', () => {
  it('reserves the full mission at the end of annual data', () => {
    const end = '2027-11-01T00:00:00Z'
    const start = latestMissionStartUtc(end, 30)
    expect(start).toBe('2027-10-02T00:00:00.000Z')
    expect(Date.parse(start!) + 30 * 86400000).toBe(Date.parse(end))
  })
  it('reserves a full 90-day mission at the end of annual data', () => {
    expect(latestMissionStartUtc('2027-11-01T00:00:00Z', 90)).toBe('2027-08-03T00:00:00.000Z')
    expect(latestMissionStartUtc('2027-11-01T00:00:00Z', 91)).toBe('2027-08-03T00:00:00.000Z')
  })
  it('does not crash the picker while invalid settings are being corrected', () => {
    for (const days of [1e9, -1e9, NaN, Infinity]) {
      expect(latestMissionStartUtc('2027-11-01T00:00:00Z', days)).toMatch(/^2027-/)
    }
    expect(latestMissionStartUtc('invalid', 7)).toBeNull()
  })
  it('keeps UTC clock time when shifting five days across month and year boundaries', () => {
    expect(shiftUtc('2026-12-29T23:50:00Z', 120)).toBe('2027-01-03T23:50:00Z')
    expect(shiftUtc('2027-02-27T01:20:00Z', 120)).toBe('2027-03-04T01:20:00Z')
  })
  it('round trips UTC input without converting to the browser timezone', () => {
    expect(fromInputUtc(toInputUtc('2026-11-15T23:50:00Z'))).toBe('2026-11-15T23:50:00Z')
    expect(fromInputUtc('2027-02-30T01:20')).toBeNull()
  })
})
