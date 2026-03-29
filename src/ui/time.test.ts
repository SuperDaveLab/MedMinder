import { describe, expect, it } from 'vitest'
import { formatAbsoluteDateTime, formatRelativeTime } from './time'

describe('time formatting safety', () => {
  it('returns stable fallback text for invalid absolute dates', () => {
    expect(formatAbsoluteDateTime(new Date(Number.NaN))).toBe('Invalid date')
  })

  it('returns stable fallback text for invalid relative dates', () => {
    const now = new Date('2026-03-29T12:00:00.000Z')
    expect(formatRelativeTime(new Date(Number.NaN), now)).toBe('invalid time')
    expect(formatRelativeTime(now, new Date(Number.NaN))).toBe('invalid time')
  })
})
