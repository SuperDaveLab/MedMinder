import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { medMinderDb } from './database'
import { createMedication, createPatient, updatePatient } from './repository'

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

describe('repository validation guards', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('rejects creating a patient without display name', async () => {
    await expect(createPatient({ displayName: '   ' })).rejects.toThrow(
      'Patient displayName is required.',
    )
  })

  it('rejects updating patient to empty display name', async () => {
    const created = await createPatient({ displayName: 'Alex' })

    await expect(
      updatePatient(created.id, { displayName: '' }),
    ).rejects.toThrow('Patient displayName is required.')
  })

  it('rejects medication creation for unknown patient id', async () => {
    await expect(
      createMedication({
        patientId: 'missing-patient',
        name: 'Example Med',
        defaultDoseText: '1 tablet',
        active: true,
        schedule: {
          type: 'interval',
          intervalMinutes: 60,
        },
      }),
    ).rejects.toThrow('Medication patientId is invalid; patient not found.')
  })
})
