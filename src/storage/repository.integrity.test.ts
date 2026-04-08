import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DoseEvent, Medication, Patient } from '../domain/types'
import { medMinderDb } from './database'
import { ensureSeeded, getLocalMedMinderState } from './repository'

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

describe('repository integrity repair', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('removes orphaned medications and dose events during startup integrity check', async () => {
    const patient: Patient = {
      id: 'patient-1',
      displayName: 'Alex Rivera',
      notificationsEnabled: false,
    }

    const validMedication: Medication = {
      id: 'med-valid',
      patientId: 'patient-1',
      name: 'Valid Medication',
      active: true,
      defaultDoseText: '1 tablet',
      schedule: {
        type: 'interval',
        intervalMinutes: 60,
      },
      reminderSettings: {
        enabled: true,
        earlyReminderMinutes: 10,
      },
    }

    const orphanedMedication: Medication = {
      ...validMedication,
      id: 'med-orphaned',
      patientId: 'missing-patient',
      name: 'Orphaned Medication',
    }

    const validDoseEvent: DoseEvent = {
      id: 'dose-valid',
      medicationId: 'med-valid',
      timestampGiven: '2026-04-08T10:00:00.000Z',
      corrected: false,
    }

    const orphanedMedicationDoseEvent: DoseEvent = {
      id: 'dose-orphaned-medication',
      medicationId: 'med-orphaned',
      timestampGiven: '2026-04-08T10:05:00.000Z',
      corrected: false,
    }

    const missingMedicationDoseEvent: DoseEvent = {
      id: 'dose-missing-medication',
      medicationId: 'med-missing',
      timestampGiven: '2026-04-08T10:10:00.000Z',
      corrected: false,
    }

    await medMinderDb.patients.put(patient)
    await medMinderDb.medications.bulkPut([validMedication, orphanedMedication])
    await medMinderDb.doseEvents.bulkPut([
      validDoseEvent,
      orphanedMedicationDoseEvent,
      missingMedicationDoseEvent,
    ])

    await ensureSeeded()

    const state = await getLocalMedMinderState()

    expect(state.patients.map((entry) => entry.id)).toEqual(['patient-1'])
    expect(state.medications.map((entry) => entry.id)).toEqual(['med-valid'])
    expect(state.doseEvents.map((entry) => entry.id)).toEqual(['dose-valid'])
  })
})