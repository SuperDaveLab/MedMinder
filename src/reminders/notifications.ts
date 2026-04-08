import type { DoseEvent, Medication } from '../domain/types'
import { calculateMedicationSchedule } from '../engine/scheduling'

export type ReminderPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'

export interface ReminderNotificationCandidate {
  medicationId: string
  patientId: string
  medicationName: string
  kind: 'due-soon' | 'due-now' | 'overdue'
  nextEligibleAtIso: string
  dedupeKey: string
  title: string
  body: string
}

export interface GroupedReminderNotification {
  patientId: string
  kind: 'due-soon' | 'due-now' | 'overdue'
  medicationNames: string[]
  dedupeKey: string
  title: string
  body: string
}

function formatLocalReminderDateTime(isoDateTime: string): string {
  const date = new Date(isoDateTime)

  if (Number.isNaN(date.getTime())) {
    return isoDateTime
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function getReminderPermissionState(): ReminderPermissionState {
  if (typeof Notification === 'undefined') {
    return 'unsupported'
  }

  return Notification.permission
}

export function getReminderStatusLabel(permission: ReminderPermissionState): string {
  if (permission === 'unsupported') {
    return 'Reminders unavailable on this device/browser.'
  }

  if (permission === 'granted') {
    return 'Reminders enabled.'
  }

  if (permission === 'denied') {
    return 'Reminders disabled (permission denied in browser settings).'
  }

  return 'Reminders disabled (permission not granted yet).'
}

export function buildReminderNotificationCandidates(
  medications: Medication[],
  doseEvents: DoseEvent[],
  now: Date,
  disabledPatientIds?: ReadonlySet<string>,
  validPatientIds?: ReadonlySet<string>,
): ReminderNotificationCandidate[] {
  if (Number.isNaN(now.getTime())) {
    return []
  }

  const candidates: ReminderNotificationCandidate[] = []

  for (const medication of medications) {
    if (validPatientIds && !validPatientIds.has(medication.patientId)) {
      continue
    }

    if (disabledPatientIds?.has(medication.patientId)) {
      continue
    }

    const remindersEnabled =
      medication.reminderSettings?.enabled ??
      (medication.schedule.type === 'prn' ? false : true)

    if (!medication.active || !remindersEnabled) {
      continue
    }

    const schedule = calculateMedicationSchedule(medication, doseEvents, now)

    if (
      Number.isNaN(schedule.nextEligibleAt.getTime()) ||
      (schedule.reminderAt !== null && Number.isNaN(schedule.reminderAt.getTime()))
    ) {
      continue
    }

    const nextEligibleAtIso = schedule.nextEligibleAt.toISOString()
    const nextEligibleAtDisplay = formatLocalReminderDateTime(nextEligibleAtIso)
    const isPrn = medication.schedule.type === 'prn'

    if (now.getTime() >= schedule.nextEligibleAt.getTime()) {
      if (isPrn) {
        const dedupeKey = `${medication.id}:due-now:${nextEligibleAtIso}`
        candidates.push({
          medicationId: medication.id,
          patientId: medication.patientId,
          medicationName: medication.name,
          kind: 'due-now',
          nextEligibleAtIso,
          dedupeKey,
          title: `${medication.name}: due now`,
          body: `Next eligible at ${nextEligibleAtDisplay}.`,
        })
        continue
      }

      const overdueMinutes = Math.floor(
        (now.getTime() - schedule.nextEligibleAt.getTime()) / 60_000,
      )
      const overdueInterval = medication.overdueReminderIntervalMinutes ?? 30

      if (overdueMinutes >= overdueInterval) {
        const overdueBucket = Math.floor(
          overdueMinutes / overdueInterval,
        )
        const dedupeKey = `${medication.id}:overdue:${nextEligibleAtIso}:${String(overdueBucket)}`

        candidates.push({
          medicationId: medication.id,
          patientId: medication.patientId,
          medicationName: medication.name,
          kind: 'overdue',
          nextEligibleAtIso,
          dedupeKey,
          title: `${medication.name}: still overdue`,
          body: `Was eligible at ${nextEligibleAtDisplay}.`,
        })
        continue
      }

      const dedupeKey = `${medication.id}:due-now:${nextEligibleAtIso}`
      candidates.push({
        medicationId: medication.id,
        patientId: medication.patientId,
        medicationName: medication.name,
        kind: 'due-now',
        nextEligibleAtIso,
        dedupeKey,
        title: `${medication.name}: due now`,
        body: `Next eligible at ${nextEligibleAtDisplay}.`,
      })
      continue
    }

    if (isPrn) {
      continue
    }

    if (
      schedule.reminderAt &&
      now.getTime() >= schedule.reminderAt.getTime() &&
      now.getTime() < schedule.nextEligibleAt.getTime()
    ) {
      const dedupeKey = `${medication.id}:due-soon:${nextEligibleAtIso}`
      candidates.push({
        medicationId: medication.id,
        patientId: medication.patientId,
        medicationName: medication.name,
        kind: 'due-soon',
        nextEligibleAtIso,
        dedupeKey,
        title: `${medication.name}: due soon`,
        body: `Eligible at ${nextEligibleAtDisplay}.`,
      })
    }
  }

  return candidates
}

export function filterUnsentReminderCandidates(
  candidates: ReminderNotificationCandidate[],
  sentReminderLog: Record<string, string>,
): ReminderNotificationCandidate[] {
  return candidates.filter((candidate) => !sentReminderLog[candidate.dedupeKey])
}

export function groupReminderNotificationsByPatient(
  candidates: ReminderNotificationCandidate[],
): GroupedReminderNotification[] {
  if (candidates.length === 0) {
    return []
  }

  // Group candidates by patientId + kind
  const grouped = new Map<string, ReminderNotificationCandidate[]>()

  for (const candidate of candidates) {
    const groupKey = `${candidate.patientId}:${candidate.kind}`
    const existing = grouped.get(groupKey) ?? []
    grouped.set(groupKey, [...existing, candidate])
  }

  // Convert to grouped notifications
  const grouped_notifications: GroupedReminderNotification[] = []

  for (const [, group] of grouped) {
    const patientId = group[0].patientId
    const kind = group[0].kind
    const medicationNames = group.map((c) => c.medicationName)

    // Create a sorted, stable dedupe key combining patient, kind, and sorted med IDs
    const sortedMedIds = group.map((c) => c.medicationId).sort()
    const compositeDedupeKey = `${patientId}:${kind}:${sortedMedIds.join(',')}`

    const title =
      medicationNames.length === 1
        ? `${medicationNames[0]}: ${kind === 'due-soon' ? 'due soon' : kind === 'due-now' ? 'due now' : 'still overdue'}`
        : `${medicationNames.length} medications: ${kind === 'due-soon' ? 'due soon' : kind === 'due-now' ? 'available now' : 'overdue'}`

    const body =
      medicationNames.length === 1
        ? kind === 'due-soon'
          ? `Eligible at ${group[0].body.split(' ').slice(2).join(' ')}`
          : group[0].body
        : medicationNames.join(', ')

    grouped_notifications.push({
      patientId,
      kind,
      medicationNames,
      dedupeKey: compositeDedupeKey,
      title,
      body,
    })
  }

  return grouped_notifications
}
