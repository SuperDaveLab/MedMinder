import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication } from '../domain/types'
import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
  getReminderStatusLabel,
  groupReminderNotificationsByPatient,
  type ReminderNotificationCandidate,
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

  it('treats PRN medications as notifications-off by default when reminder settings are missing', () => {
    const prnMedication: Medication = {
      ...baseMedication,
      id: 'med-prn-default-off',
      name: 'Ibuprofen PRN',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 6 * 60,
      },
      reminderSettings: undefined,
    }

    const candidates = buildReminderNotificationCandidates(
      [prnMedication],
      [
        {
          ...baseDoseEvents[0],
          id: 'dose-prn-default-off',
          medicationId: 'med-prn-default-off',
        },
      ],
      new Date('2026-03-28T12:10:00.000Z'),
    )

    expect(candidates).toEqual([])
  })

  it('for PRN sends only a due-now candidate for each eligibility window (no due-soon or overdue)', () => {
    const prnMedication: Medication = {
      ...baseMedication,
      id: 'med-prn-enabled',
      name: 'Ibuprofen PRN',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 6 * 60,
      },
      reminderSettings: {
        enabled: true,
        earlyReminderMinutes: 10,
      },
    }

    const prnDoseEvents: DoseEvent[] = [
      {
        id: 'dose-prn-1',
        medicationId: 'med-prn-enabled',
        timestampGiven: '2026-03-28T06:00:00.000Z',
        corrected: false,
      },
    ]

    const dueSoonCandidates = buildReminderNotificationCandidates(
      [prnMedication],
      prnDoseEvents,
      new Date('2026-03-28T11:55:00.000Z'),
    )
    expect(dueSoonCandidates).toEqual([])

    const dueNowCandidates = buildReminderNotificationCandidates(
      [prnMedication],
      prnDoseEvents,
      new Date('2026-03-28T12:01:00.000Z'),
    )
    expect(dueNowCandidates).toHaveLength(1)
    expect(dueNowCandidates[0].kind).toBe('due-now')

    const pastWindowCandidates = buildReminderNotificationCandidates(
      [prnMedication],
      prnDoseEvents,
      new Date('2026-03-28T12:45:00.000Z'),
    )
    expect(pastWindowCandidates).toHaveLength(1)
    expect(pastWindowCandidates[0].kind).toBe('due-now')
    expect(pastWindowCandidates[0].dedupeKey).toBe(dueNowCandidates[0].dedupeKey)
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

  it('respects per-medication overdueReminderIntervalMinutes; defaults to 30 minutes', () => {
    // Medication with custom 60-minute overdue interval
    const medWith60MinInterval: Medication = {
      ...baseMedication,
      id: 'med-60min',
      overdueReminderIntervalMinutes: 60,
    }

    const doseEventsFor60Min: DoseEvent[] = [
      {
        id: 'dose-60min-1',
        medicationId: 'med-60min',
        timestampGiven: '2026-03-28T06:00:00.000Z',
        corrected: false,
      },
    ]

    // At 14:00 (just eligible): due-now candidate emitted
    const atEligible = buildReminderNotificationCandidates(
      [medWith60MinInterval],
      doseEventsFor60Min,
      new Date('2026-03-28T14:00:00.000Z'),
    )
    expect(atEligible).toHaveLength(1)
    expect(atEligible[0].kind).toBe('due-now')

    // At 14:45 (45 min overdue): still just due-now, no overdue yet
    // Note: overdue only triggers after overdueReminderIntervalMinutes pass
    const at45Minutes = buildReminderNotificationCandidates(
      [medWith60MinInterval],
      doseEventsFor60Min,
      new Date('2026-03-28T14:45:00.000Z'),
    )
    expect(at45Minutes).toHaveLength(1)
    expect(at45Minutes[0].kind).toBe('due-now')

    // At 15:00 (60 minutes overdue): first overdue notification
    const at60Minutes = buildReminderNotificationCandidates(
      [medWith60MinInterval],
      doseEventsFor60Min,
      new Date('2026-03-28T15:00:00.000Z'),
    )
    expect(at60Minutes).toHaveLength(1)
    expect(at60Minutes[0].kind).toBe('overdue')
    expect(at60Minutes[0].dedupeKey).toContain(':1')

    // At 15:59 (119 minutes overdue): still bucket 1, same dedup key
    const at119Minutes = buildReminderNotificationCandidates(
      [medWith60MinInterval],
      doseEventsFor60Min,
      new Date('2026-03-28T15:59:00.000Z'),
    )
    expect(at119Minutes).toHaveLength(1)
    expect(at119Minutes[0].dedupeKey).toBe(at60Minutes[0].dedupeKey)

    // At 16:01 (121 minutes overdue): bucket 2, new dedup key triggers resend
    const at121Minutes = buildReminderNotificationCandidates(
      [medWith60MinInterval],
      doseEventsFor60Min,
      new Date('2026-03-28T16:01:00.000Z'),
    )
    expect(at121Minutes).toHaveLength(1)
    expect(at121Minutes[0].kind).toBe('overdue')
    expect(at121Minutes[0].dedupeKey).toContain(':2')

    // Verify default 30-minute interval also works
    const medWithDefault: Medication = {
      ...baseMedication,
      // no overdueReminderIntervalMinutes set; should default to 30
    }

    // 30 minutes overdue should trigger first overdue
    const defaultAt30Min = buildReminderNotificationCandidates(
      [medWithDefault],
      baseDoseEvents,
      new Date('2026-03-28T14:30:00.000Z'),
    )
    expect(defaultAt30Min).toHaveLength(1)
    expect(defaultAt30Min[0].kind).toBe('overdue')
  })

  it('groups candidates by patient and kind into single notifications', () => {
    const med1: ReminderNotificationCandidate = {
      medicationId: 'med-a',
      patientId: 'patient-1',
      medicationName: 'Medication A',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-a',
      title: 'Medication A: due now',
      body: 'Next eligible at ...',
    }

    const med2: ReminderNotificationCandidate = {
      medicationId: 'med-b',
      patientId: 'patient-1',
      medicationName: 'Medication B',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-b',
      title: 'Medication B: due now',
      body: 'Next eligible at ...',
    }

    const grouped = groupReminderNotificationsByPatient([med1, med2])

    expect(grouped).toHaveLength(1)
    expect(grouped[0].patientId).toBe('patient-1')
    expect(grouped[0].kind).toBe('due-now')
    expect(grouped[0].medicationNames).toEqual(['Medication A', 'Medication B'])
    expect(grouped[0].title).toContain('2 medications')
    expect(grouped[0].title).toContain('available now')
    expect(grouped[0].body).toContain('Medication A, Medication B')
  })

  it('groups medications by patient and kind; different kinds stay separate', () => {
    const dueSoon: ReminderNotificationCandidate = {
      medicationId: 'med-a',
      patientId: 'patient-1',
      medicationName: 'Medication A',
      kind: 'due-soon',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-a',
      title: 'Medication A: due soon',
      body: 'Eligible at ...',
    }

    const dueNow: ReminderNotificationCandidate = {
      medicationId: 'med-b',
      patientId: 'patient-1',
      medicationName: 'Medication B',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-b',
      title: 'Medication B: due now',
      body: 'Next eligible at ...',
    }

    const grouped = groupReminderNotificationsByPatient([dueSoon, dueNow])

    expect(grouped).toHaveLength(2)
    const dueSoonGroup = grouped.find((g) => g.kind === 'due-soon')
    const dueNowGroup = grouped.find((g) => g.kind === 'due-now')

    expect(dueSoonGroup?.medicationNames).toEqual(['Medication A'])
    expect(dueNowGroup?.medicationNames).toEqual(['Medication B'])
  })

  it('creates stable composite dedupe keys that change when medication list changes', () => {
    const med1: ReminderNotificationCandidate = {
      medicationId: 'med-1',
      patientId: 'patient-1',
      medicationName: 'Med 1',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-1',
      title: 'Med 1: due now',
      body: 'Next eligible at ...',
    }

    const med2: ReminderNotificationCandidate = {
      medicationId: 'med-2',
      patientId: 'patient-1',
      medicationName: 'Med 2',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-2',
      title: 'Med 2: due now',
      body: 'Next eligible at ...',
    }

    // Group with both medications
    const grouped1 = groupReminderNotificationsByPatient([med1, med2])
    expect(grouped1).toHaveLength(1)
    const key1 = grouped1[0].dedupeKey

    // Group with only med1
    const grouped2 = groupReminderNotificationsByPatient([med1])
    expect(grouped2).toHaveLength(1)
    const key2 = grouped2[0].dedupeKey

    // Keys should be different (med list changed)
    expect(key1).not.toBe(key2)
    expect(key1).toContain('patient-1:due-now:med-1,med-2')
    expect(key2).toContain('patient-1:due-now:med-1')
  })

  it('groups notifications from different patients separately', () => {
    const patientA: ReminderNotificationCandidate = {
      medicationId: 'med-a',
      patientId: 'patient-a',
      medicationName: 'Med A',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-a',
      title: 'Med A: due now',
      body: 'Next eligible at ...',
    }

    const patientB: ReminderNotificationCandidate = {
      medicationId: 'med-b',
      patientId: 'patient-b',
      medicationName: 'Med B',
      kind: 'due-now',
      nextEligibleAtIso: '2026-03-28T14:00:00.000Z',
      dedupeKey: 'key-b',
      title: 'Med B: due now',
      body: 'Next eligible at ...',
    }

    const grouped = groupReminderNotificationsByPatient([patientA, patientB])

    expect(grouped).toHaveLength(2)
    const groupA = grouped.find((g) => g.patientId === 'patient-a')
    const groupB = grouped.find((g) => g.patientId === 'patient-b')

    expect(groupA?.medicationNames).toEqual(['Med A'])
    expect(groupB?.medicationNames).toEqual(['Med B'])
  })

  it('returns empty list for empty candidates', () => {
    const grouped = groupReminderNotificationsByPatient([])
    expect(grouped).toEqual([])
  })
})
