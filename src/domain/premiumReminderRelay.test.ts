import { describe, expect, it } from 'vitest'
import type { MedMinderState } from './types'
import { buildPremiumReminderSyncPayload } from './premiumReminderRelay'

const baseState: MedMinderState = {
  patients: [
    {
      id: 'patient-1',
      displayName: 'Alex Rivera',
    },
    {
      id: 'patient-2',
      displayName: 'Morgan Lee',
    },
  ],
  medications: [
    {
      id: 'med-interval',
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
    },
    {
      id: 'med-disabled',
      patientId: 'patient-1',
      name: 'Disabled reminder med',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'interval',
        intervalMinutes: 6 * 60,
      },
      reminderSettings: {
        enabled: false,
      },
    },
    {
      id: 'med-inactive',
      patientId: 'patient-2',
      name: 'Inactive med',
      active: false,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'fixed_times',
        timesOfDay: ['08:00'],
      },
      reminderSettings: {
        enabled: true,
      },
    },
  ],
  doseEvents: [
    {
      id: 'dose-original',
      medicationId: 'med-interval',
      timestampGiven: '2026-03-28T06:00:00.000Z',
      corrected: false,
    },
    {
      id: 'dose-correction',
      medicationId: 'med-interval',
      timestampGiven: '2026-03-28T07:00:00.000Z',
      corrected: true,
      supersedesDoseEventId: 'dose-original',
    },
  ],
}

describe('premium reminder relay payload', () => {
  it('builds a full snapshot for active medications with reminders enabled', () => {
    const payload = buildPremiumReminderSyncPayload(baseState, {
      now: new Date('2026-03-28T14:01:00.000Z'),
      subscription: {
        relayAccountId: 'relay-account-1',
        timezone: 'America/New_York',
        channels: ['web_push', 'email'],
        emailAddress: 'caregiver@example.com',
      },
      source: {
        appVersion: '0.1.0',
        installationId: 'install-1',
      },
    })

    expect(payload.schemaVersion).toBe(1)
    expect(payload.subscription.channels).toEqual(['web_push', 'email'])
    expect(payload.policy.notificationKind).toBe('due_now')
    expect(payload.patients).toEqual([
      {
        patientId: 'patient-1',
        displayName: 'Alex Rivera',
      },
    ])
    expect(payload.medications).toHaveLength(1)
    expect(payload.medications[0].medicationId).toBe('med-interval')
  })

  it('includes corrected-dose-aware timing snapshot for backend due-now evaluation', () => {
    const payload = buildPremiumReminderSyncPayload(baseState, {
      now: new Date('2026-03-28T14:01:00.000Z'),
      subscription: {
        relayAccountId: 'relay-account-1',
        timezone: 'America/Chicago',
        channels: ['web_push', 'email'],
      },
    })

    expect(payload.medications[0].timing.lastGivenAt).toBe('2026-03-28T07:00:00.000Z')
    expect(payload.medications[0].timing.nextEligibleAt).toBe('2026-03-28T15:00:00.000Z')
    expect(payload.medications[0].timing.reminderAt).toBe('2026-03-28T14:50:00.000Z')
    expect(payload.medications[0].timing.eligibleNow).toBe(false)
  })

  it('creates an empty monitored snapshot when no medications are relay eligible', () => {
    const payload = buildPremiumReminderSyncPayload(
      {
        ...baseState,
        medications: baseState.medications.map((medication) => ({
          ...medication,
          active: false,
        })),
      },
      {
        now: new Date('2026-03-28T14:01:00.000Z'),
        subscription: {
          relayAccountId: 'relay-account-1',
          timezone: 'UTC',
          channels: ['email'],
        },
      },
    )

    expect(payload.patients).toEqual([])
    expect(payload.medications).toEqual([])
  })
})