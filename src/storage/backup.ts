import type { DoseEvent, Medication, Patient } from '../domain/types'
import { parseLocalDateToTimestamp } from '../domain/dateParsing'

export interface NexpillBackup {
  schemaVersion: 1
  exportedAt: string
  patients: Patient[]
  medications: Medication[]
  doseEvents: DoseEvent[]
  reminderNotificationLog: Record<string, string>
}

export type BackupValidationResult =
  | { valid: true; backup: NexpillBackup }
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
      `Unrecognized backup schemaVersion: "${String(obj['schemaVersion'])}". This backup may be from a different version of Nexpill.`,
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

  if (m['inventoryEnabled'] !== undefined && typeof m['inventoryEnabled'] !== 'boolean') {
    return `Medication "${String(m['id'])}": inventoryEnabled must be boolean when provided.`
  }

  if (m['inventoryEnabled'] === true) {
    if (typeof m['initialQuantity'] !== 'number' || m['initialQuantity'] < 0) {
      return `Medication "${String(m['id'])}": initialQuantity must be zero or positive when inventory is enabled.`
    }

    if (typeof m['doseAmount'] !== 'number' || m['doseAmount'] <= 0) {
      return `Medication "${String(m['id'])}": doseAmount must be positive when inventory is enabled.`
    }

    if (
      m['lowSupplyThreshold'] !== undefined &&
      (typeof m['lowSupplyThreshold'] !== 'number' || m['lowSupplyThreshold'] < 0)
    ) {
      return `Medication "${String(m['id'])}": lowSupplyThreshold must be zero or positive when provided.`
    }
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

    for (const timeValue of s['timesOfDay'] as unknown[]) {
      if (typeof timeValue !== 'string' || !isValidTimeOfDay(timeValue)) {
        return `Medication "${medicationId}": fixed_times timesOfDay entries must be HH:mm strings.`
      }
    }

    return null
  }

  if (s['type'] === 'taper') {
    if (!Array.isArray(s['rules']) || (s['rules'] as unknown[]).length === 0) {
      return `Medication "${medicationId}": taper schedule must have non-empty rules.`
    }

    const ruleWindows: Array<{ startAt: number; endAt: number }> = []

    for (const ruleValue of s['rules'] as unknown[]) {
      if (typeof ruleValue !== 'object' || ruleValue === null || Array.isArray(ruleValue)) {
        return `Medication "${medicationId}": each taper rule must be an object.`
      }

      const rule = ruleValue as Record<string, unknown>

      if (typeof rule['intervalMinutes'] !== 'number' || !Number.isFinite(rule['intervalMinutes']) || rule['intervalMinutes'] <= 0) {
        return `Medication "${medicationId}": each taper rule must have positive intervalMinutes.`
      }

      if (typeof rule['startDate'] !== 'string') {
        return `Medication "${medicationId}": each taper rule must have startDate in YYYY-MM-DD format.`
      }

      const startAt = parseLocalDateToTimestamp(rule['startDate'])
      if (startAt === null) {
        return `Medication "${medicationId}": taper rule startDate must be a valid YYYY-MM-DD date.`
      }

      let endAt = Number.POSITIVE_INFINITY

      if (rule['endDate'] !== undefined) {
        if (typeof rule['endDate'] !== 'string') {
          return `Medication "${medicationId}": taper rule endDate must be YYYY-MM-DD when provided.`
        }

        const parsedEndAt = parseLocalDateToTimestamp(rule['endDate'])
        if (parsedEndAt === null) {
          return `Medication "${medicationId}": taper rule endDate must be a valid YYYY-MM-DD date.`
        }

        if (parsedEndAt <= startAt) {
          return `Medication "${medicationId}": taper rule endDate must be after startDate.`
        }

        endAt = parsedEndAt
      }

      ruleWindows.push({ startAt, endAt })
    }

    const sortedRuleWindows = [...ruleWindows].sort((a, b) => a.startAt - b.startAt)

    for (let index = 1; index < sortedRuleWindows.length; index += 1) {
      const previousRule = sortedRuleWindows[index - 1]
      const currentRule = sortedRuleWindows[index]

      if (currentRule.startAt < previousRule.endAt) {
        return `Medication "${medicationId}": taper rules must not overlap.`
      }
    }

    return null
  }

  return `Medication "${medicationId}": schedule.type must be one of interval, prn, fixed_times, taper.`
}

function isValidTimeOfDay(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value)

  if (!match) {
    return false
  }

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
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
