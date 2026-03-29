import type { DoseEvent, Medication, Patient } from '../domain/types'

export interface MedMinderBackup {
  schemaVersion: 1
  exportedAt: string
  patients: Patient[]
  medications: Medication[]
  doseEvents: DoseEvent[]
  reminderNotificationLog: Record<string, string>
}

export type BackupValidationResult =
  | { valid: true; backup: MedMinderBackup }
  | { valid: false; error: string }

function fail(error: string): { valid: false; error: string } {
  return { valid: false, error }
}

export function validateBackup(raw: unknown): BackupValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('Backup must be a JSON object.')
  }

  const obj = raw as Record<string, unknown>

  if (obj['schemaVersion'] !== 1) {
    return fail(
      `Unrecognized backup schemaVersion: "${String(obj['schemaVersion'])}". This backup may be from a different version of Med-Minder.`,
    )
  }

  if (typeof obj['exportedAt'] !== 'string' || Number.isNaN(Date.parse(obj['exportedAt']))) {
    return fail('Backup is missing a valid exportedAt timestamp.')
  }

  if (!Array.isArray(obj['patients'])) {
    return fail('Backup patients must be an array.')
  }

  for (const item of obj['patients'] as unknown[]) {
    const err = checkPatient(item)
    if (err) return fail(err)
  }

  if (!Array.isArray(obj['medications'])) {
    return fail('Backup medications must be an array.')
  }

  for (const item of obj['medications'] as unknown[]) {
    const err = checkMedication(item)
    if (err) return fail(err)
  }

  if (!Array.isArray(obj['doseEvents'])) {
    return fail('Backup doseEvents must be an array.')
  }

  for (const item of obj['doseEvents'] as unknown[]) {
    const err = checkDoseEvent(item)
    if (err) return fail(err)
  }

  if (
    obj['reminderNotificationLog'] !== undefined &&
    (typeof obj['reminderNotificationLog'] !== 'object' ||
      obj['reminderNotificationLog'] === null ||
      Array.isArray(obj['reminderNotificationLog']))
  ) {
    return fail('Backup reminderNotificationLog must be an object when present.')
  }

  const log = obj['reminderNotificationLog'] ?? {}

  return {
    valid: true,
    backup: {
      schemaVersion: 1,
      exportedAt: obj['exportedAt'] as string,
      patients: obj['patients'] as Patient[],
      medications: obj['medications'] as Medication[],
      doseEvents: obj['doseEvents'] as DoseEvent[],
      reminderNotificationLog: log as Record<string, string>,
    },
  }
}

function checkPatient(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return 'Each patient must be an object.'
  }

  const p = raw as Record<string, unknown>

  if (typeof p['id'] !== 'string' || !p['id']) {
    return 'Each patient must have a non-empty string id.'
  }

  if (typeof p['displayName'] !== 'string' || !String(p['displayName']).trim()) {
    return `Patient "${String(p['id'])}": displayName is required.`
  }

  return null
}

function checkMedication(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return 'Each medication must be an object.'
  }

  const m = raw as Record<string, unknown>

  if (typeof m['id'] !== 'string' || !m['id']) {
    return 'Each medication must have a non-empty string id.'
  }

  if (typeof m['patientId'] !== 'string' || !m['patientId']) {
    return `Medication "${String(m['id'])}": patientId is required.`
  }

  if (typeof m['name'] !== 'string' || !String(m['name']).trim()) {
    return `Medication "${String(m['id'])}": name is required.`
  }

  if (typeof m['defaultDoseText'] !== 'string' || !String(m['defaultDoseText']).trim()) {
    return `Medication "${String(m['id'])}": defaultDoseText is required.`
  }

  if (typeof m['active'] !== 'boolean') {
    return `Medication "${String(m['id'])}": active must be boolean.`
  }

  return checkSchedule(String(m['id']), m['schedule'])
}

function checkSchedule(medicationId: string, raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return `Medication "${medicationId}": schedule must be an object.`
  }

  const s = raw as Record<string, unknown>

  if (s['type'] === 'interval') {
    if (typeof s['intervalMinutes'] !== 'number' || s['intervalMinutes'] <= 0) {
      return `Medication "${medicationId}": interval schedule must have positive intervalMinutes.`
    }
    return null
  }

  if (s['type'] === 'prn') {
    if (typeof s['minimumIntervalMinutes'] !== 'number' || s['minimumIntervalMinutes'] <= 0) {
      return `Medication "${medicationId}": prn schedule must have positive minimumIntervalMinutes.`
    }
    return null
  }

  if (s['type'] === 'fixed_times') {
    if (!Array.isArray(s['timesOfDay']) || (s['timesOfDay'] as unknown[]).length === 0) {
      return `Medication "${medicationId}": fixed_times schedule must have non-empty timesOfDay.`
    }
    return null
  }

  if (s['type'] === 'taper') {
    if (!Array.isArray(s['rules']) || (s['rules'] as unknown[]).length === 0) {
      return `Medication "${medicationId}": taper schedule must have non-empty rules.`
    }
    return null
  }

  return `Medication "${medicationId}": schedule.type must be one of interval, prn, fixed_times, taper.`
}

function checkDoseEvent(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return 'Each dose event must be an object.'
  }

  const d = raw as Record<string, unknown>

  if (typeof d['id'] !== 'string' || !d['id']) {
    return 'Each dose event must have a non-empty string id.'
  }

  if (typeof d['medicationId'] !== 'string' || !d['medicationId']) {
    return `DoseEvent "${String(d['id'])}": medicationId is required.`
  }

  if (
    typeof d['timestampGiven'] !== 'string' ||
    Number.isNaN(Date.parse(d['timestampGiven'] as string))
  ) {
    return `DoseEvent "${String(d['id'])}": timestampGiven must be a valid ISO date string.`
  }

  if (d['corrected'] !== true && d['corrected'] !== false) {
    return `DoseEvent "${String(d['id'])}": corrected must be boolean.`
  }

  if (
    d['corrected'] === true &&
    (typeof d['supersedesDoseEventId'] !== 'string' || !d['supersedesDoseEventId'])
  ) {
    return `DoseEvent "${String(d['id'])}": corrected event must have supersedesDoseEventId.`
  }

  return null
}
