import { describe, expect, it } from 'vitest'
import { buildBootstrapSyncRequest } from './cloudSync'
import type { NexpillState } from './types'

const baseState: NexpillState = {
  patients: [
    {
      id: 'patient-1',
      displayName: 'Alex Rivera',
    },
  ],
  medications: [
    {
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
    },
  ],
  doseEvents: [
    {
      id: 'dose-original',
      medicationId: 'med-1',
      timestampGiven: '2026-03-28T06:00:00.000Z',
      corrected: false,
    },
    {
      id: 'dose-correction',
      medicationId: 'med-1',
      timestampGiven: '2026-03-28T07:00:00.000Z',
      corrected: true,
      supersedesDoseEventId: 'dose-original',
    },
  ],
}

describe('cloud sync contracts', () => {
  it('builds a bootstrap sync request that carries full local state as upserts', () => {
    const request = buildBootstrapSyncRequest(baseState, {
      accountId: 'account-1',
      now: new Date('2026-04-06T15:30:00.000Z'),
      device: {
        deviceId: 'device-1',
        platform: 'pwa',
        appVersion: '0.1.0',
        timezone: 'America/New_York',
      },
    })

    expect(request.schemaVersion).toBe(1)
    expect(request.mode).toBe('bootstrap')
    expect(request.cursor).toBeNull()
    expect(request.mutations).toHaveLength(4)
  })

  it('tags each bootstrap mutation with null baseVersion for initial upload', () => {
    const request = buildBootstrapSyncRequest(baseState, {
      accountId: 'account-1',
      now: new Date('2026-04-06T15:30:00.000Z'),
      device: {
        deviceId: 'device-1',
        platform: 'pwa',
      },
    })

    expect(request.mutations.every((mutation) => mutation.kind === 'upsert')).toBe(true)
    expect(request.mutations.every((mutation) => mutation.baseVersion === null)).toBe(true)
  })

  it('preserves corrected dose event structure in uploaded mutations', () => {
    const request = buildBootstrapSyncRequest(baseState, {
      accountId: 'account-1',
      now: new Date('2026-04-06T15:30:00.000Z'),
      device: {
        deviceId: 'device-1',
        platform: 'pwa',
      },
    })

    const correctionMutation = request.mutations.find(
      (mutation) => mutation.kind === 'upsert' && mutation.recordId === 'dose-correction',
    )

    expect(correctionMutation).toBeTruthy()
    if (!correctionMutation || correctionMutation.kind !== 'upsert') {
      return
    }

    expect(correctionMutation.entityType).toBe('dose_event')
    expect(correctionMutation.payload).toMatchObject({
      corrected: true,
      supersedesDoseEventId: 'dose-original',
    })
  })
})