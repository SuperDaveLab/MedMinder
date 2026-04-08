import type { MedMinderState } from './types'

export interface SanitizedMedMinderStateResult {
  state: MedMinderState
  removedMedicationIds: string[]
  removedDoseEventIds: string[]
}

export function sanitizeMedMinderState(
  state: MedMinderState,
): SanitizedMedMinderStateResult {
  const validPatientIds = new Set(state.patients.map((patient) => patient.id))
  const medications = state.medications.filter((medication) => validPatientIds.has(medication.patientId))
  const validMedicationIds = new Set(medications.map((medication) => medication.id))
  const doseEvents = state.doseEvents.filter((doseEvent) => validMedicationIds.has(doseEvent.medicationId))

  return {
    state: {
      patients: state.patients,
      medications,
      doseEvents,
    },
    removedMedicationIds: state.medications
      .filter((medication) => !validPatientIds.has(medication.patientId))
      .map((medication) => medication.id),
    removedDoseEventIds: state.doseEvents
      .filter((doseEvent) => !validMedicationIds.has(doseEvent.medicationId))
      .map((doseEvent) => doseEvent.id),
  }
}