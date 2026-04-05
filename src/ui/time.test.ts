import { describe, expect, it } from 'vitest'
import {
  chooseDurationUnit,
  durationMinutesToValue,
  durationValueToMinutes,
  formatAbsoluteDateTime,
  formatDurationMinutesCompact,
  formatDurationMinutesLong,
  formatRelativeTime,
} from './time'

describe('time formatting safety', () => {
  it('returns stable fallback text for invalid absolute dates', () => {
    expect(formatAbsoluteDateTime(new Date(Number.NaN))).toBe('Invalid date')
  })

  it('returns stable fallback text for invalid relative dates', () => {
    const now = new Date('2026-03-29T12:00:00.000Z')
    expect(formatRelativeTime(new Date(Number.NaN), now)).toBe('invalid time')
    expect(formatRelativeTime(now, new Date(Number.NaN))).toBe('invalid time')
  })

  it('formats duration values in compact and long forms', () => {
    expect(formatDurationMinutesCompact(285)).toBe('4h 45m')
    expect(formatDurationMinutesLong(1440)).toBe('1 day')
  })

  it('converts duration form values between units and minutes', () => {
    expect(durationValueToMinutes(8, 'hours')).toBe(480)
    expect(chooseDurationUnit(480)).toBe('hours')
    expect(durationMinutesToValue(480, 'hours')).toBe('8')
  })
})
