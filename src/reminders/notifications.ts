import type { DoseEvent, Medication } from '../domain/types'
import { calculateMedicationSchedule } from '../engine/scheduling'

export type ReminderPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'

const OVERDUE_REMINDER_INTERVAL_MINUTES = 30

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
): ReminderNotificationCandidate[] {
  if (Number.isNaN(now.getTime())) {
    return []
  }

  const candidates: ReminderNotificationCandidate[] = []

  for (const medication of medications) {
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

      if (overdueMinutes >= OVERDUE_REMINDER_INTERVAL_MINUTES) {
        const overdueBucket = Math.floor(
          overdueMinutes / OVERDUE_REMINDER_INTERVAL_MINUTES,
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
