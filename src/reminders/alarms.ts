import type { DoseEvent, Medication } from '../domain/types'
import { calculateMedicationSchedule } from '../engine/scheduling'

export interface AlarmCandidate {
  medicationId: string
  medicationName: string
  nextEligibleAtIso: string
  dedupeKey: string
}

function supportsInAppAlarm(medication: Medication): boolean {
  return medication.schedule.type === 'interval' || medication.schedule.type === 'fixed_times'
}

export function buildInAppAlarmCandidates(
  medications: Medication[],
  doseEvents: DoseEvent[],
  now: Date,
  disabledPatientIds?: ReadonlySet<string>,
  validPatientIds?: ReadonlySet<string>,
): AlarmCandidate[] {
  if (Number.isNaN(now.getTime())) {
    return []
  }

  const dueCandidates: Array<AlarmCandidate & { nextEligibleAtTimestamp: number }> = []

  for (const medication of medications) {
    if (validPatientIds && !validPatientIds.has(medication.patientId)) {
      continue
    }

    if (disabledPatientIds?.has(medication.patientId)) {
      continue
    }

    if (!medication.active || !supportsInAppAlarm(medication) || !medication.reminderSettings?.alarmEnabled) {
      continue
    }

    const schedule = calculateMedicationSchedule(medication, doseEvents, now)

    if (Number.isNaN(schedule.nextEligibleAt.getTime())) {
      continue
    }

    if (now.getTime() < schedule.nextEligibleAt.getTime()) {
      continue
    }

    const nextEligibleAtIso = schedule.nextEligibleAt.toISOString()

    dueCandidates.push({
      medicationId: medication.id,
      medicationName: medication.name,
      nextEligibleAtIso,
      dedupeKey: `${medication.id}:alarm:${nextEligibleAtIso}`,
      nextEligibleAtTimestamp: schedule.nextEligibleAt.getTime(),
    })
  }

  return dueCandidates
    .sort((a, b) => a.nextEligibleAtTimestamp - b.nextEligibleAtTimestamp)
    .map((candidate) => ({
      medicationId: candidate.medicationId,
      medicationName: candidate.medicationName,
      nextEligibleAtIso: candidate.nextEligibleAtIso,
      dedupeKey: candidate.dedupeKey,
    }))
}
