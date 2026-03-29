import type { DoseEvent, Medication } from '../domain/types'
import { calculateMedicationSchedule } from '../engine/scheduling'

export type ReminderPermissionState =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'

export interface ReminderNotificationCandidate {
  medicationId: string
  medicationName: string
  kind: 'due-soon' | 'due-now'
  nextEligibleAtIso: string
  dedupeKey: string
  title: string
  body: string
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
  const candidates: ReminderNotificationCandidate[] = []

  for (const medication of medications) {
    if (!medication.active) {
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

    if (now.getTime() >= schedule.nextEligibleAt.getTime()) {
      const dedupeKey = `${medication.id}:due-now:${nextEligibleAtIso}`
      candidates.push({
        medicationId: medication.id,
        medicationName: medication.name,
        kind: 'due-now',
        nextEligibleAtIso,
        dedupeKey,
        title: `${medication.name}: due now`,
        body: `Next eligible at ${nextEligibleAtIso}.`,
      })
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
        medicationName: medication.name,
        kind: 'due-soon',
        nextEligibleAtIso,
        dedupeKey,
        title: `${medication.name}: due soon`,
        body: `Eligible at ${nextEligibleAtIso}.`,
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
