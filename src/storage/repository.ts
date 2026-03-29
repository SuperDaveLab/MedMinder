import type { DoseEvent, Medication, Patient } from '../domain/types'
import { initialSampleState } from '../data/sampleData'
import { medMinderDb } from './database'

const LAST_SELECTED_PATIENT_ID_KEY = 'lastSelectedPatientId'

export async function getPatients(): Promise<Patient[]> {
  return medMinderDb.patients.toArray()
}

export async function getMedicationsByPatient(
  patientId: string,
): Promise<Medication[]> {
  return medMinderDb.medications.where('patientId').equals(patientId).toArray()
}

export async function getDoseEventsByMedication(
  medicationId: string,
): Promise<DoseEvent[]> {
  const doseEvents = await medMinderDb.doseEvents
    .where('medicationId')
    .equals(medicationId)
    .toArray()

  return doseEvents.sort((a, b) =>
    b.timestampGiven.localeCompare(a.timestampGiven),
  )
}

export async function getDoseEventsByMedicationIds(
  medicationIds: string[],
): Promise<DoseEvent[]> {
  if (medicationIds.length === 0) {
    return []
  }

  const doseEvents = await medMinderDb.doseEvents
    .where('medicationId')
    .anyOf(medicationIds)
    .toArray()

  return doseEvents.sort((a, b) =>
    b.timestampGiven.localeCompare(a.timestampGiven),
  )
}

export async function addDoseEvent(doseEvent: DoseEvent): Promise<void> {
  await medMinderDb.doseEvents.add(doseEvent)
}

export async function savePatient(patient: Patient): Promise<void> {
  await medMinderDb.patients.put(patient)
}

export async function saveMedication(medication: Medication): Promise<void> {
  await medMinderDb.medications.put(medication)
}

export async function ensureSeeded(): Promise<void> {
  const [patientCount, medicationCount, doseEventCount] = await Promise.all([
    medMinderDb.patients.count(),
    medMinderDb.medications.count(),
    medMinderDb.doseEvents.count(),
  ])

  if (patientCount !== 0 || medicationCount !== 0 || doseEventCount !== 0) {
    return
  }

  await medMinderDb.transaction(
    'rw',
    medMinderDb.patients,
    medMinderDb.medications,
    medMinderDb.doseEvents,
    async () => {
      await medMinderDb.patients.bulkPut(initialSampleState.patients)
      await medMinderDb.medications.bulkPut(initialSampleState.medications)
      await medMinderDb.doseEvents.bulkPut(initialSampleState.doseEvents)
    },
  )
}

export async function loadPatientMedicationView(patientId: string): Promise<{
  medications: Medication[]
  doseEvents: DoseEvent[]
}> {
  const medications = await getMedicationsByPatient(patientId)
  const doseEvents = await getDoseEventsByMedicationIds(
    medications.map((medication) => medication.id),
  )

  return { medications, doseEvents }
}

export async function getLastSelectedPatientId(): Promise<string | null> {
  const record = await medMinderDb.appSettings.get(LAST_SELECTED_PATIENT_ID_KEY)

  return record?.value ?? null
}

export async function saveLastSelectedPatientId(patientId: string): Promise<void> {
  await medMinderDb.appSettings.put({
    key: LAST_SELECTED_PATIENT_ID_KEY,
    value: patientId,
  })
}
