import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication } from '../domain/types'
import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
  getReminderStatusLabel,
} from './notifications'

const baseMedication: Medication = {
  id: 'med-1',
  patientId: 'patient-1',
  name: 'Amoxicillin',
  active: true,
  defaultDoseText: '500 mg',
  schedule: {
    type: 'interval',
    intervalMinutes: 8 * 60,
  },
  reminderSettings: {
    enabled: true,
    earlyReminderMinutes: 10,
  },
}

const baseDoseEvents: DoseEvent[] = [
  {
    id: 'dose-1',
    medicationId: 'med-1',
    timestampGiven: '2026-03-28T06:00:00.000Z',
    corrected: false,
  },
]

describe('reminder notifications', () => {
  it('maps permission states to clear reminder status labels', () => {
    expect(getReminderStatusLabel('unsupported')).toContain('unavailable')
    expect(getReminderStatusLabel('default')).toContain('disabled')
    expect(getReminderStatusLabel('denied')).toContain('disabled')
    expect(getReminderStatusLabel('granted')).toContain('enabled')
  })

  it('builds due-soon and due-now candidates at correct transition times', () => {
    const beforeReminder = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date('2026-03-28T13:49:00.000Z'),
    )
    expect(beforeReminder.length).toBe(0)

    const dueSoon = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date('2026-03-28T13:55:00.000Z'),
    )
    expect(dueSoon.length).toBe(1)
    expect(dueSoon[0].kind).toBe('due-soon')

    const dueNow = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date('2026-03-28T14:01:00.000Z'),
    )
    expect(dueNow.length).toBe(1)
    expect(dueNow[0].kind).toBe('due-now')
  })

  it('skips medications with reminders explicitly disabled', () => {
    const disabledMedication: Medication = {
      ...baseMedication,
      reminderSettings: {
        enabled: false,
        earlyReminderMinutes: 10,
      },
    }

    const candidates = buildReminderNotificationCandidates(
      [disabledMedication],
      baseDoseEvents,
      new Date('2026-03-28T14:01:00.000Z'),
    )

    expect(candidates).toEqual([])
  })

  it('creates overdue follow-up candidates in 30-minute buckets', () => {
    const overdue = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date('2026-03-28T14:31:00.000Z'),
    )

    expect(overdue).toHaveLength(1)
    expect(overdue[0].kind).toBe('overdue')
    expect(overdue[0].title).toContain('still overdue')
    expect(overdue[0].dedupeKey).toBe('med-1:overdue:2026-03-28T14:00:00.000Z:1')
  })

  it('filters out already-sent notifications using dedupe keys', () => {
    const dueSoonCandidates = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date('2026-03-28T13:55:00.000Z'),
    )

    expect(dueSoonCandidates.length).toBe(1)

    const sentLog = {
      [dueSoonCandidates[0].dedupeKey]: '2026-03-28T13:55:00.000Z',
    }

    const unsent = filterUnsentReminderCandidates(dueSoonCandidates, sentLog)
    expect(unsent.length).toBe(0)
  })

  it('skips reminder candidates when now is invalid', () => {
    const candidates = buildReminderNotificationCandidates(
      [baseMedication],
      baseDoseEvents,
      new Date(Number.NaN),
    )

    expect(candidates).toEqual([])
  })
})
