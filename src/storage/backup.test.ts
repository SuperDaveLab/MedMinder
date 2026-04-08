import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { medMinderDb } from './database'
import { validateBackup } from './backup'
import {
  exportFullBackup,
  getReminderNotificationLog,
  importFullBackup,
} from './repository'

async function clearDatabase(): Promise<void> {
  await medMinderDb.transaction(
    'rw',
    medMinderDb.patients,
    medMinderDb.medications,
    medMinderDb.doseEvents,
    medMinderDb.appSettings,
    async () => {
      await medMinderDb.patients.clear()
      await medMinderDb.medications.clear()
      await medMinderDb.doseEvents.clear()
      await medMinderDb.appSettings.clear()
    },
  )
}

function buildValidBackup() {
  return {
    schemaVersion: 1 as const,
    exportedAt: '2026-03-29T12:00:00.000Z',
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
        defaultDoseText: '500mg',
        active: true,
        schedule: {
          type: 'interval' as const,
          intervalMinutes: 240,
        },
      },
    ],
    doseEvents: [
      {
        id: 'dose-1',
        medicationId: 'med-1',
        timestampGiven: '2026-03-29T08:00:00.000Z',
        corrected: false as const,
      },
    ],
    reminderNotificationLog: {
      'med-1:due-now:2026-03-29T12:00:00.000Z': '2026-03-29T12:00:05.000Z',
    },
  }
}

describe('backup validation', () => {
  it('accepts a valid backup payload', () => {
    const result = validateBackup(buildValidBackup())

    expect(result.valid).toBe(true)
  })

  it('rejects unknown schemaVersion', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      schemaVersion: 2,
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('schemaVersion')
    }
  })

  it('rejects non-array patients', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      patients: {},
    })

    expect(result.valid).toBe(false)
  })

  it('rejects patient missing displayName', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      patients: [{ id: 'patient-1' }],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects medication missing schedule', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          id: 'med-1',
          patientId: 'patient-1',
          name: 'Amoxicillin',
          defaultDoseText: '500mg',
          active: true,
        },
      ],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects inventory-enabled medication with invalid inventory values', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          ...buildValidBackup().medications[0],
          inventoryEnabled: true,
          initialQuantity: 30,
          doseAmount: 0,
        },
      ],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects fixed_times schedule with invalid timesOfDay entries', () => {
    const invalidValueResult = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          ...buildValidBackup().medications[0],
          schedule: {
            type: 'fixed_times',
            timesOfDay: [123],
          },
        },
      ],
    })

    expect(invalidValueResult.valid).toBe(false)

    const invalidFormatResult = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          ...buildValidBackup().medications[0],
          schedule: {
            type: 'fixed_times',
            timesOfDay: ['25:00'],
          },
        },
      ],
    })

    expect(invalidFormatResult.valid).toBe(false)
  })

  it('rejects taper schedule with invalid or overlapping rules', () => {
    const invalidRuleResult = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          ...buildValidBackup().medications[0],
          schedule: {
            type: 'taper',
            rules: [
              {
                startDate: '2026-03-01',
                intervalMinutes: 0,
              },
            ],
          },
        },
      ],
    })

    expect(invalidRuleResult.valid).toBe(false)

    const overlappingRulesResult = validateBackup({
      ...buildValidBackup(),
      medications: [
        {
          ...buildValidBackup().medications[0],
          schedule: {
            type: 'taper',
            rules: [
              {
                startDate: '2026-03-01',
                endDate: '2026-03-10',
                intervalMinutes: 240,
              },
              {
                startDate: '2026-03-05',
                endDate: '2026-03-15',
                intervalMinutes: 360,
              },
            ],
          },
        },
      ],
    })

    expect(overlappingRulesResult.valid).toBe(false)
  })

  it('rejects corrected dose event without supersedesDoseEventId', () => {
    const result = validateBackup({
      ...buildValidBackup(),
      doseEvents: [
        {
          id: 'dose-1-correction',
          medicationId: 'med-1',
          timestampGiven: '2026-03-29T08:30:00.000Z',
          corrected: true,
        },
      ],
    })

    expect(result.valid).toBe(false)
  })

  it('rejects null, arrays, and primitives', () => {
    expect(validateBackup(null).valid).toBe(false)
    expect(validateBackup([]).valid).toBe(false)
    expect(validateBackup('x').valid).toBe(false)
    expect(validateBackup(123).valid).toBe(false)
  })
})

describe('backup repository round-trip', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('exports and imports full data with full-replace behavior', async () => {
    const backup = buildValidBackup()

    await medMinderDb.patients.bulkPut(backup.patients)
    await medMinderDb.medications.bulkPut(backup.medications)
    await medMinderDb.doseEvents.bulkPut(backup.doseEvents)
    await medMinderDb.appSettings.put({
      key: 'reminderNotificationLog',
      value: JSON.stringify(backup.reminderNotificationLog),
    })

    const exported = await exportFullBackup()

    await medMinderDb.patients.put({ id: 'patient-old', displayName: 'Old Patient' })
    await medMinderDb.appSettings.put({
      key: 'lastSelectedPatientId',
      value: 'patient-old',
    })

    await importFullBackup(exported)

    const patients = await medMinderDb.patients.toArray()
    const medications = await medMinderDb.medications.toArray()
    const doseEvents = await medMinderDb.doseEvents.toArray()
    const reminderLog = await getReminderNotificationLog()
    const lastSelected = await medMinderDb.appSettings.get('lastSelectedPatientId')

    expect(patients).toHaveLength(1)
    expect(patients[0].id).toBe('patient-1')
    expect(medications).toHaveLength(1)
    expect(medications[0].id).toBe('med-1')
    expect(doseEvents).toHaveLength(1)
    expect(doseEvents[0].id).toBe('dose-1')
    expect(reminderLog).toEqual(backup.reminderNotificationLog)
    expect(lastSelected).toBeUndefined()
  })
})
