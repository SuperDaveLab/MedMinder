import type { DoseEvent, Medication, Patient } from '../domain/types'
import { parseLocalDateToTimestamp } from '../domain/dateParsing'
import type { MedMinderBackup } from './backup'
import { initialSampleState } from '../data/sampleData'
import { medMinderDb } from './database'

const LAST_SELECTED_PATIENT_ID_KEY = 'lastSelectedPatientId'
const REMINDER_NOTIFICATION_LOG_KEY = 'reminderNotificationLog'

function isValidTimeOfDay(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value)

  if (!match) {
    return false
  }

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function assertValidMedicationSchedule(schedule: Medication['schedule']): void {
  if (schedule.type === 'interval') {
    if (!Number.isFinite(schedule.intervalMinutes) || schedule.intervalMinutes <= 0) {
      throw new Error('Interval schedule must use a positive intervalMinutes value.')
    }
    return
  }

  if (schedule.type === 'fixed_times') {
    if (schedule.timesOfDay.length === 0 || !schedule.timesOfDay.every(isValidTimeOfDay)) {
      throw new Error('Fixed times schedule must include valid HH:mm times.')
    }
    return
  }

  if (schedule.type === 'prn') {
    if (
      !Number.isFinite(schedule.minimumIntervalMinutes) ||
      schedule.minimumIntervalMinutes <= 0
    ) {
      throw new Error('PRN schedule must use a positive minimumIntervalMinutes value.')
    }
    return
  }

  if (schedule.rules.length === 0) {
    throw new Error('Taper schedule must include at least one rule.')
  }

  for (const rule of schedule.rules) {
    if (parseLocalDateToTimestamp(rule.startDate) === null) {
      throw new Error('Taper rule startDate must be a valid YYYY-MM-DD date.')
    }

    if (rule.endDate && parseLocalDateToTimestamp(rule.endDate) === null) {
      throw new Error('Taper rule endDate must be a valid YYYY-MM-DD date when provided.')
    }

    if (!Number.isFinite(rule.intervalMinutes) || rule.intervalMinutes <= 0) {
      throw new Error('Taper rule intervalMinutes must be positive.')
    }
  }
}

export async function getPatients(): Promise<Patient[]> {
  return medMinderDb.patients.toArray()
}

export async function getLocalMedMinderState(): Promise<{
  patients: Patient[]
  medications: Medication[]
  doseEvents: DoseEvent[]
}> {
  const [patients, medications, doseEvents] = await Promise.all([
    medMinderDb.patients.toArray(),
    medMinderDb.medications.toArray(),
    medMinderDb.doseEvents.toArray(),
  ])

  return {
    patients,
    medications,
    doseEvents,
  }
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

export interface CreateDoseCorrectionInput {
  originalDoseEventId: string
  replacementTimestampGiven: string
  notes?: string
}

export async function createDoseCorrectionEvent(
  input: CreateDoseCorrectionInput,
): Promise<DoseEvent> {
  const originalDoseEvent = await medMinderDb.doseEvents.get(input.originalDoseEventId)

  if (!originalDoseEvent) {
    throw new Error('Original dose event not found for correction.')
  }

  if (Number.isNaN(Date.parse(input.replacementTimestampGiven))) {
    throw new Error('Replacement timestamp must be a valid ISO datetime.')
  }

  const correctionDoseEvent: DoseEvent = {
    id: crypto.randomUUID(),
    medicationId: originalDoseEvent.medicationId,
    timestampGiven: input.replacementTimestampGiven,
    doseText: originalDoseEvent.doseText,
    givenBy: originalDoseEvent.givenBy,
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
    corrected: true,
    supersedesDoseEventId: originalDoseEvent.id,
  }

  await medMinderDb.doseEvents.add(correctionDoseEvent)

  return correctionDoseEvent
}

export async function savePatient(patient: Patient): Promise<void> {
  await medMinderDb.patients.put(patient)
}

export interface UpsertPatientInput {
  displayName: string
  notes?: string
}

export async function createPatient(input: UpsertPatientInput): Promise<Patient> {
  const displayName = input.displayName.trim()

  if (!displayName) {
    throw new Error('Patient displayName is required.')
  }

  const patient: Patient = {
    id: crypto.randomUUID(),
    displayName,
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
  }

  await medMinderDb.patients.add(patient)

  return patient
}

export async function updatePatient(
  patientId: string,
  input: UpsertPatientInput,
): Promise<Patient> {
  const displayName = input.displayName.trim()

  if (!displayName) {
    throw new Error('Patient displayName is required.')
  }

  const existingPatient = await medMinderDb.patients.get(patientId)

  if (!existingPatient) {
    throw new Error('Patient not found for update.')
  }

  const updatedPatient: Patient = {
    ...existingPatient,
    displayName,
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
  }

  await medMinderDb.patients.put(updatedPatient)

  return updatedPatient
}

export async function setPatientNotificationsEnabled(patientId: string, enabled: boolean): Promise<void> {
  const patient = await medMinderDb.patients.get(patientId)

  if (!patient) {
    throw new Error('Patient not found for notification update.')
  }

  await medMinderDb.patients.put({
    ...patient,
    notificationsEnabled: enabled,
  })
}

/**
 * Safe destructive delete for patient administration.
 * Cascades to all medications for the patient and all associated dose events.
 */
export async function deletePatientCascade(patientId: string): Promise<void> {
  await medMinderDb.transaction(
    'rw',
    medMinderDb.patients,
    medMinderDb.medications,
    medMinderDb.doseEvents,
    async () => {
      const medicationIds = (
        await medMinderDb.medications.where('patientId').equals(patientId).toArray()
      ).map((medication) => medication.id)

      if (medicationIds.length > 0) {
        await medMinderDb.doseEvents.where('medicationId').anyOf(medicationIds).delete()
        await medMinderDb.medications.where('id').anyOf(medicationIds).delete()
      }

      await medMinderDb.patients.delete(patientId)
    },
  )
}

export async function saveMedication(medication: Medication): Promise<void> {
  await medMinderDb.medications.put(medication)
}

export interface UpsertMedicationInput {
  patientId: string
  name: string
  strengthText?: string
  instructions?: string
  defaultDoseText: string
  active: boolean
  schedule: Medication['schedule']
  reminderSettings?: Medication['reminderSettings']
  overdueReminderIntervalMinutes?: number
}

export async function createMedication(
  input: UpsertMedicationInput,
): Promise<Medication> {
  const patient = await medMinderDb.patients.get(input.patientId)

  if (!patient) {
    throw new Error('Medication patientId is invalid; patient not found.')
  }

  const medicationName = input.name.trim()
  const defaultDoseText = input.defaultDoseText.trim()

  if (!medicationName) {
    throw new Error('Medication name is required.')
  }

  if (!defaultDoseText) {
    throw new Error('Medication defaultDoseText is required.')
  }

  assertValidMedicationSchedule(input.schedule)

  const medication: Medication = {
    id: crypto.randomUUID(),
    patientId: input.patientId,
    name: medicationName,
    strengthText: input.strengthText?.trim() ? input.strengthText.trim() : undefined,
    instructions: input.instructions?.trim() ? input.instructions.trim() : undefined,
    defaultDoseText,
    active: input.active,
    schedule: input.schedule,
    reminderSettings: input.reminderSettings,
    overdueReminderIntervalMinutes: input.overdueReminderIntervalMinutes ?? 30,
  }

  await medMinderDb.medications.add(medication)

  return medication
}

export async function updateMedication(
  medicationId: string,
  input: UpsertMedicationInput,
): Promise<Medication> {
  const patient = await medMinderDb.patients.get(input.patientId)

  if (!patient) {
    throw new Error('Medication patientId is invalid; patient not found.')
  }

  const medicationName = input.name.trim()
  const defaultDoseText = input.defaultDoseText.trim()

  if (!medicationName) {
    throw new Error('Medication name is required.')
  }

  if (!defaultDoseText) {
    throw new Error('Medication defaultDoseText is required.')
  }

  assertValidMedicationSchedule(input.schedule)

  const existingMedication = await medMinderDb.medications.get(medicationId)

  if (!existingMedication) {
    throw new Error('Medication not found for update.')
  }

  const updatedMedication: Medication = {
    ...existingMedication,
    patientId: input.patientId,
    name: medicationName,
    strengthText: input.strengthText?.trim() ? input.strengthText.trim() : undefined,
    instructions: input.instructions?.trim() ? input.instructions.trim() : undefined,
    defaultDoseText,
    active: input.active,
    schedule: input.schedule,
    reminderSettings: input.reminderSettings,
    overdueReminderIntervalMinutes: input.overdueReminderIntervalMinutes ?? 30,
  }

  await medMinderDb.medications.put(updatedMedication)

  return updatedMedication
}

export async function deactivateMedication(medicationId: string): Promise<void> {
  const medication = await medMinderDb.medications.get(medicationId)

  if (!medication) {
    throw new Error('Medication not found for deactivation.')
  }

  await medMinderDb.medications.put({
    ...medication,
    active: false,
  })
}

export async function activateMedication(medicationId: string): Promise<void> {
  const medication = await medMinderDb.medications.get(medicationId)

  if (!medication) {
    throw new Error('Medication not found for activation.')
  }

  await medMinderDb.medications.put({
    ...medication,
    active: true,
  })
}

export async function deleteMedicationCascade(medicationId: string): Promise<void> {
  await medMinderDb.transaction(
    'rw',
    medMinderDb.medications,
    medMinderDb.doseEvents,
    async () => {
      await medMinderDb.doseEvents.where('medicationId').equals(medicationId).delete()
      await medMinderDb.medications.delete(medicationId)
    },
  )
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

export async function getReminderNotificationLog(): Promise<Record<string, string>> {
  const record = await medMinderDb.appSettings.get(REMINDER_NOTIFICATION_LOG_KEY)

  if (!record?.value) {
    return {}
  }

  try {
    const parsed = JSON.parse(record.value) as Record<string, string>

    if (parsed && typeof parsed === 'object') {
      return parsed
    }

    return {}
  } catch {
    return {}
  }
}

export async function saveReminderNotificationLog(
  reminderLog: Record<string, string>,
): Promise<void> {
  const prunedLog = pruneReminderNotificationLog(reminderLog, new Date())

  await medMinderDb.appSettings.put({
    key: REMINDER_NOTIFICATION_LOG_KEY,
    value: JSON.stringify(prunedLog),
  })
}

/**
 * Keep reminder dedupe storage small and local-only.
 *
 * Strategy:
 * - drop entries older than maxAgeDays
 * - keep newest maxEntries entries
 */
export function pruneReminderNotificationLog(
  reminderLog: Record<string, string>,
  now: Date,
  maxAgeDays = 30,
  maxEntries = 500,
): Record<string, string> {
  const cutoffTime = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000

  const entries = Object.entries(reminderLog)
    .filter(([, sentAtIso]) => {
      const parsedTime = Date.parse(sentAtIso)

      return !Number.isNaN(parsedTime) && parsedTime >= cutoffTime
    })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, maxEntries)

  return Object.fromEntries(entries)
}

// ---------------------------------------------------------------------------
// Backup export / import
// ---------------------------------------------------------------------------

/**
 * Read all data from the local database and return it as a structured backup
 * object. The reminderNotificationLog is included so reminders do not
 * re-fire after a restore. lastSelectedPatientId is intentionally excluded
 * because it is transient UI state.
 */
export async function exportFullBackup(): Promise<MedMinderBackup> {
  const [patients, medications, doseEvents, reminderLogRecord] = await Promise.all([
    medMinderDb.patients.toArray(),
    medMinderDb.medications.toArray(),
    medMinderDb.doseEvents.toArray(),
    medMinderDb.appSettings.get(REMINDER_NOTIFICATION_LOG_KEY),
  ])

  let reminderNotificationLog: Record<string, string> = {}
  if (reminderLogRecord?.value) {
    try {
      const parsed = JSON.parse(reminderLogRecord.value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        reminderNotificationLog = parsed as Record<string, string>
      }
    } catch {
      // Ignore parse errors and export an empty log.
    }
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    patients,
    medications,
    doseEvents,
    reminderNotificationLog,
  }
}

/**
 * Fully replace all database contents with the given backup.
 * Runs inside a single Dexie transaction so the operation is atomic.
 * Call validateBackup() before this to ensure the data is well-formed.
 */
export async function importFullBackup(backup: MedMinderBackup): Promise<void> {
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

      await medMinderDb.patients.bulkPut(backup.patients)
      await medMinderDb.medications.bulkPut(backup.medications)
      await medMinderDb.doseEvents.bulkPut(backup.doseEvents)
      await medMinderDb.appSettings.put({
        key: REMINDER_NOTIFICATION_LOG_KEY,
        value: JSON.stringify(backup.reminderNotificationLog),
      })
    },
  )
}

export async function clearLocalClinicalData(): Promise<void> {
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
      await medMinderDb.appSettings.delete(LAST_SELECTED_PATIENT_ID_KEY)
    },
  )
}
