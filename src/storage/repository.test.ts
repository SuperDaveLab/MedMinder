import { describe, expect, it } from 'vitest'
import { pruneReminderNotificationLog } from './repository'

describe('pruneReminderNotificationLog', () => {
  it('removes old entries and keeps most recent within cap', () => {
    const now = new Date('2026-03-29T12:00:00.000Z')
    const reminderLog = {
      'med-1:due-now:1': '2026-03-29T11:00:00.000Z',
      'med-2:due-now:1': '2026-03-20T11:00:00.000Z',
      'med-3:due-now:1': '2025-01-01T00:00:00.000Z',
      'med-4:due-now:1': 'invalid-date',
    }

    const result = pruneReminderNotificationLog(reminderLog, now, 14, 2)

    expect(Object.keys(result)).toHaveLength(2)
    expect(result['med-1:due-now:1']).toBeTruthy()
    expect(result['med-2:due-now:1']).toBeTruthy()
    expect(result['med-3:due-now:1']).toBeUndefined()
    expect(result['med-4:due-now:1']).toBeUndefined()
  })
})
