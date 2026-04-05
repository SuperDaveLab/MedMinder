import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication } from '../domain/types'
import { buildInAppAlarmCandidates } from './alarms'

const baseDoseEvents: DoseEvent[] = [
  {
    id: 'dose-1',
    medicationId: 'med-1',
    timestampGiven: '2026-03-28T06:00:00.000Z',
    corrected: false,
  },
]

function buildMedication(overrides: Partial<Medication>): Medication {
  return {
    id: 'med-1',
    patientId: 'patient-1',
    name: 'Amoxicillin',
    active: true,
    defaultDoseText: '1 capsule',
    schedule: {
      type: 'interval',
      intervalMinutes: 8 * 60,
    },
    reminderSettings: {
      enabled: true,
      earlyReminderMinutes: 10,
      alarmEnabled: true,
    },
    ...overrides,
  }
}

describe('in-app alarms', () => {
  it('creates due alarm candidates for interval and fixed_times with alarm enabled', () => {
    const intervalMedication = buildMedication({
      id: 'med-interval',
      name: 'Amoxicillin',
      schedule: {
        type: 'interval',
        intervalMinutes: 8 * 60,
      },
    })

    const fixedTimesMedication = buildMedication({
      id: 'med-fixed',
      name: 'Levothyroxine',
      schedule: {
        type: 'fixed_times',
        timesOfDay: ['08:00', '20:00'],
      },
    })

    const candidates = buildInAppAlarmCandidates(
      [intervalMedication, fixedTimesMedication],
      [
        ...baseDoseEvents,
        {
          id: 'dose-fixed',
          medicationId: 'med-fixed',
          timestampGiven: '2026-03-28T08:00:00.000Z',
          corrected: false,
        },
      ],
      new Date('2026-03-28T20:01:00.000Z'),
    )

    expect(candidates.length).toBe(2)
    expect(candidates[0].dedupeKey).toContain(':alarm:')
  })

  it('does not create candidates for unsupported schedules or disabled alarms', () => {
    const prnMedication = buildMedication({
      id: 'med-prn',
      schedule: {
        type: 'prn',
        minimumIntervalMinutes: 120,
      },
    })

    const intervalAlarmDisabled = buildMedication({
      id: 'med-interval-disabled',
      reminderSettings: {
        enabled: true,
        alarmEnabled: false,
      },
    })

    const candidates = buildInAppAlarmCandidates(
      [prnMedication, intervalAlarmDisabled],
      baseDoseEvents,
      new Date('2026-03-28T20:01:00.000Z'),
    )

    expect(candidates).toEqual([])
  })
})
