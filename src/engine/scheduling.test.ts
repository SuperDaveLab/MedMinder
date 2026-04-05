import { describe, expect, it } from 'vitest'
import {
  calculateMedicationSchedule,
} from './scheduling'
import type {
  DoseEvent,
  Medication,
} from '../domain/types'

const now = new Date('2026-03-28T10:00:00.000Z')

describe('scheduling engine', () => {
  it('calculates interval status with no doses from anchor time', () => {
    const medication: Medication = {
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

    const result = calculateMedicationSchedule(medication, [], now)

    expect(result.lastGivenAt).toBeNull()
    expect(result.eligibleNow).toBe(true)
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T10:00:00.000Z')
    expect(result.tooEarlyByMinutes).toBeNull()
    expect(result.overdueByMinutes).toBeNull()
    expect(result.reminderAt?.toISOString()).toBe('2026-03-28T09:50:00.000Z')
  })

  it('calculates interval too-early window using latest valid dose event', () => {
    const medication: Medication = {
      id: 'med-2',
      patientId: 'patient-1',
      name: 'Antibiotic',
      active: true,
      defaultDoseText: '250 mg',
      schedule: {
        type: 'interval',
        intervalMinutes: 6 * 60,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-1',
        medicationId: 'med-2',
        timestampGiven: '2026-03-28T07:00:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.lastGivenAt?.toISOString()).toBe('2026-03-28T07:00:00.000Z')
    expect(result.eligibleNow).toBe(false)
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T13:00:00.000Z')
    expect(result.tooEarlyByMinutes).toBe(180)
    expect(result.overdueByMinutes).toBeNull()
  })

  it('keeps PRN available-now without overdue once lockout has passed', () => {
    const medication: Medication = {
      id: 'med-3',
      patientId: 'patient-1',
      name: 'Pain reliever',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 4 * 60,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-2',
        medicationId: 'med-3',
        timestampGiven: '2026-03-28T04:45:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.lastGivenAt?.toISOString()).toBe('2026-03-28T04:45:00.000Z')
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T08:45:00.000Z')
    expect(result.eligibleNow).toBe(true)
    expect(result.tooEarlyByMinutes).toBeNull()
    expect(result.overdueByMinutes).toBeNull()
  })

  it('treats PRN with no dose history as eligible now', () => {
    const medication: Medication = {
      id: 'med-3b',
      patientId: 'patient-1',
      name: 'PRN nausea',
      active: true,
      defaultDoseText: '4 mg',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 120,
      },
    }

    const result = calculateMedicationSchedule(medication, [], now)

    expect(result.lastGivenAt).toBeNull()
    expect(result.eligibleNow).toBe(true)
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T10:00:00.000Z')
    expect(result.overdueByMinutes).toBeNull()
  })

  it('applies taper interval for active step and returns too-early window', () => {
    const medication: Medication = {
      id: 'med-4',
      patientId: 'patient-1',
      name: 'Steroid taper',
      active: true,
      defaultDoseText: '10 mg',
      schedule: {
        type: 'taper',
        rules: [
          {
            startDate: '2026-03-20',
            endDate: '2026-03-25',
            intervalMinutes: 8 * 60,
          },
          {
            startDate: '2026-03-25',
            intervalMinutes: 12 * 60,
          },
        ],
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-3',
        medicationId: 'med-4',
        timestampGiven: '2026-03-28T06:30:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.lastGivenAt?.toISOString()).toBe('2026-03-28T06:30:00.000Z')
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T18:30:00.000Z')
    expect(result.eligibleNow).toBe(false)
    expect(result.tooEarlyByMinutes).toBe(510)
    expect(result.overdueByMinutes).toBeNull()
  })

  it('ignores superseded dose events when corrected entries replace them', () => {
    const medication: Medication = {
      id: 'med-5',
      patientId: 'patient-1',
      name: 'Corrected event medicine',
      active: true,
      defaultDoseText: '100 mg',
      schedule: {
        type: 'interval',
        intervalMinutes: 120,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-original',
        medicationId: 'med-5',
        timestampGiven: '2026-03-28T09:50:00.000Z',
        corrected: false,
      },
      {
        id: 'dose-correction',
        medicationId: 'med-5',
        timestampGiven: '2026-03-28T09:20:00.000Z',
        corrected: true,
        supersedesDoseEventId: 'dose-original',
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.lastGivenAt?.toISOString()).toBe('2026-03-28T09:20:00.000Z')
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T11:20:00.000Z')
    expect(result.tooEarlyByMinutes).toBe(80)
  })

  it('computes reminderAt only when reminders are enabled', () => {
    const withReminder: Medication = {
      id: 'med-6',
      patientId: 'patient-1',
      name: 'Reminder enabled med',
      active: true,
      defaultDoseText: '50 mg',
      schedule: {
        type: 'interval',
        intervalMinutes: 60,
      },
      reminderSettings: {
        enabled: true,
        earlyReminderMinutes: 15,
      },
    }

    const noReminder: Medication = {
      ...withReminder,
      id: 'med-7',
      reminderSettings: {
        enabled: false,
        earlyReminderMinutes: 15,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-6',
        medicationId: 'med-6',
        timestampGiven: '2026-03-28T09:30:00.000Z',
        corrected: false,
      },
      {
        id: 'dose-7',
        medicationId: 'med-7',
        timestampGiven: '2026-03-28T09:30:00.000Z',
        corrected: false,
      },
    ]

    const withReminderResult = calculateMedicationSchedule(withReminder, doseEvents, now)
    const noReminderResult = calculateMedicationSchedule(noReminder, doseEvents, now)

    expect(withReminderResult.nextEligibleAt.toISOString()).toBe(
      '2026-03-28T10:30:00.000Z',
    )
    expect(withReminderResult.reminderAt?.toISOString()).toBe(
      '2026-03-28T10:15:00.000Z',
    )
    expect(noReminderResult.reminderAt).toBeNull()
  })

  it('marks interval medication overdue after expected due time', () => {
    const medication: Medication = {
      id: 'med-overdue-1',
      patientId: 'patient-1',
      name: 'Overdue interval med',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'interval',
        intervalMinutes: 120,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-overdue-1',
        medicationId: 'med-overdue-1',
        timestampGiven: '2026-03-28T06:00:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T08:00:00.000Z')
    expect(result.eligibleNow).toBe(true)
    expect(result.overdueByMinutes).toBe(120)
    expect(result.tooEarlyByMinutes).toBeNull()
  })

  it('handles odd interval schedules like 4 hours 45 minutes', () => {
    const medication: Medication = {
      id: 'med-odd-interval-1',
      patientId: 'patient-1',
      name: 'Odd interval med',
      active: true,
      defaultDoseText: '1 capsule',
      schedule: {
        type: 'interval',
        intervalMinutes: 4 * 60 + 45,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-odd-interval-1',
        medicationId: 'med-odd-interval-1',
        timestampGiven: '2026-03-28T05:20:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T10:05:00.000Z')
    expect(result.eligibleNow).toBe(false)
    expect(result.tooEarlyByMinutes).toBe(5)
    expect(result.overdueByMinutes).toBeNull()
  })

  it('treats exact boundary where now equals nextEligibleAt as eligible', () => {
    const medication: Medication = {
      id: 'med-boundary-1',
      patientId: 'patient-1',
      name: 'Boundary interval med',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'interval',
        intervalMinutes: 120,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-boundary-1',
        medicationId: 'med-boundary-1',
        timestampGiven: '2026-03-28T08:00:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T10:00:00.000Z')
    expect(result.eligibleNow).toBe(true)
    expect(result.tooEarlyByMinutes).toBeNull()
    expect(result.overdueByMinutes).toBeNull()
  })

  it('keeps PRN from ever becoming overdue even long after lockout', () => {
    const medication: Medication = {
      id: 'med-prn-overdue-guard',
      patientId: 'patient-1',
      name: 'PRN long-gap med',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 60,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-prn-overdue-guard',
        medicationId: 'med-prn-overdue-guard',
        timestampGiven: '2026-03-27T00:00:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-27T01:00:00.000Z')
    expect(result.eligibleNow).toBe(true)
    expect(result.overdueByMinutes).toBeNull()
    expect(result.tooEarlyByMinutes).toBeNull()
  })

  it('fixed_times before first time of day uses previous day last slot', () => {
    const fixedNow = new Date(2026, 2, 28, 5, 0, 0, 0)
    const medication: Medication = {
      id: 'med-fixed-before-first',
      patientId: 'patient-1',
      name: 'Fixed time med',
      active: true,
      defaultDoseText: '1 drop',
      schedule: {
        type: 'fixed_times',
        timesOfDay: ['08:00', '12:00', '20:00'],
      },
    }

    const result = calculateMedicationSchedule(medication, [], fixedNow)

    expect(result.nextEligibleAt.getFullYear()).toBe(2026)
    expect(result.nextEligibleAt.getMonth()).toBe(2)
    expect(result.nextEligibleAt.getDate()).toBe(27)
    expect(result.nextEligibleAt.getHours()).toBe(20)
    expect(result.nextEligibleAt.getMinutes()).toBe(0)
  })

  it('fixed_times between slots uses latest earlier slot', () => {
    const fixedNow = new Date(2026, 2, 28, 13, 15, 0, 0)
    const medication: Medication = {
      id: 'med-fixed-between',
      patientId: 'patient-1',
      name: 'Fixed time med',
      active: true,
      defaultDoseText: '1 drop',
      schedule: {
        type: 'fixed_times',
        timesOfDay: ['08:00', '12:00', '20:00'],
      },
    }

    const result = calculateMedicationSchedule(medication, [], fixedNow)

    expect(result.nextEligibleAt.getFullYear()).toBe(2026)
    expect(result.nextEligibleAt.getMonth()).toBe(2)
    expect(result.nextEligibleAt.getDate()).toBe(28)
    expect(result.nextEligibleAt.getHours()).toBe(12)
    expect(result.nextEligibleAt.getMinutes()).toBe(0)
  })

  it('fixed_times after last slot uses same day last slot', () => {
    const fixedNow = new Date(2026, 2, 28, 23, 0, 0, 0)
    const medication: Medication = {
      id: 'med-fixed-after-last',
      patientId: 'patient-1',
      name: 'Fixed time med',
      active: true,
      defaultDoseText: '1 drop',
      schedule: {
        type: 'fixed_times',
        timesOfDay: ['08:00', '12:00', '20:00'],
      },
    }

    const result = calculateMedicationSchedule(medication, [], fixedNow)

    expect(result.nextEligibleAt.getFullYear()).toBe(2026)
    expect(result.nextEligibleAt.getMonth()).toBe(2)
    expect(result.nextEligibleAt.getDate()).toBe(28)
    expect(result.nextEligibleAt.getHours()).toBe(20)
    expect(result.nextEligibleAt.getMinutes()).toBe(0)
  })

  it('uses the new taper rule exactly at a boundary date', () => {
    const boundaryNow = new Date('2026-03-25T00:00:00.000Z')
    const medication: Medication = {
      id: 'med-taper-boundary',
      patientId: 'patient-1',
      name: 'Boundary taper med',
      active: true,
      defaultDoseText: '10 mg',
      schedule: {
        type: 'taper',
        rules: [
          {
            startDate: '2026-03-20',
            endDate: '2026-03-25',
            intervalMinutes: 8 * 60,
          },
          {
            startDate: '2026-03-25',
            intervalMinutes: 12 * 60,
          },
        ],
      },
    }

    const result = calculateMedicationSchedule(medication, [], boundaryNow)

    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-25T00:00:00.000Z')
    expect(result.eligibleNow).toBe(true)
  })

  it('ignores invalid dose timestamps when selecting latest valid dose', () => {
    const medication: Medication = {
      id: 'med-invalid-dose-ts',
      patientId: 'patient-1',
      name: 'Timestamp filter med',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'interval',
        intervalMinutes: 120,
      },
    }

    const doseEvents: DoseEvent[] = [
      {
        id: 'dose-invalid-ts',
        medicationId: 'med-invalid-dose-ts',
        timestampGiven: 'not-a-date',
        corrected: false,
      },
      {
        id: 'dose-valid-ts',
        medicationId: 'med-invalid-dose-ts',
        timestampGiven: '2026-03-28T07:00:00.000Z',
        corrected: false,
      },
    ]

    const result = calculateMedicationSchedule(medication, doseEvents, now)

    expect(result.lastGivenAt?.toISOString()).toBe('2026-03-28T07:00:00.000Z')
    expect(result.nextEligibleAt.toISOString()).toBe('2026-03-28T09:00:00.000Z')
    expect(result.overdueByMinutes).toBe(60)
  })
})
