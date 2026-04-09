import { getMedicationScheduleTypeLabel } from '../domain/types'
import type { Medication, Patient } from '../domain/types'
import type { DoseEvent } from '../domain/types'
import { calculateMedicationSchedule } from '../engine/scheduling'
import { formatAbsoluteDateTime, formatDurationMinutesLong } from '../ui/time'

export interface PatientMedicationSummaryRow {
  medicationId: string
  name: string
  strengthText?: string
  defaultDoseText?: string
  scheduleType: string
  scheduleDetails: string
  lastGiven: string
  nextEligible: string
  currentStatus: string
  reminderSetting: string
}

function describeSchedule(medication: Medication): { type: string; details: string } {
  if (medication.schedule.type === 'interval') {
    return {
      type: getMedicationScheduleTypeLabel(medication.schedule.type),
      details: `Every ${formatDurationMinutesLong(medication.schedule.intervalMinutes)}`,
    }
  }

  if (medication.schedule.type === 'fixed_times') {
    return {
      type: getMedicationScheduleTypeLabel(medication.schedule.type),
      details: `Times: ${medication.schedule.timesOfDay.join(', ')}`,
    }
  }

  if (medication.schedule.type === 'prn') {
    return {
      type: getMedicationScheduleTypeLabel(medication.schedule.type),
      details: `Minimum interval ${formatDurationMinutesLong(medication.schedule.minimumIntervalMinutes)}`,
    }
  }

  const taperRules = medication.schedule.rules
    .map((rule) => {
      const endPart = rule.endDate ? ` to ${rule.endDate}` : ''
      return `${rule.startDate}${endPart}: every ${formatDurationMinutesLong(rule.intervalMinutes)}`
    })
    .join('; ')

  return {
    type: getMedicationScheduleTypeLabel(medication.schedule.type),
    details: taperRules,
  }
}

function describeCurrentStatus(
  medication: Medication,
  now: Date,
  eligibleNow: boolean,
  tooEarlyByMinutes: number | null,
  overdueByMinutes: number | null,
): string {
  if (medication.schedule.type === 'prn' && eligibleNow) {
    return 'Available now (PRN)'
  }

  if (!eligibleNow && tooEarlyByMinutes !== null) {
    return `Too early by ${tooEarlyByMinutes} min`
  }

  if (
    medication.schedule.type === 'interval' &&
    overdueByMinutes !== null &&
    overdueByMinutes >= Math.ceil(medication.schedule.intervalMinutes * 0.5)
  ) {
    return `Missed by ${overdueByMinutes} min`
  }

  if (overdueByMinutes !== null && overdueByMinutes > 0) {
    return `Overdue by ${overdueByMinutes} min`
  }

  if (eligibleNow) {
    return 'Eligible now'
  }

  return `Status as of ${formatAbsoluteDateTime(now)}`
}

export function buildPatientMedicationSummaryRows(
  medications: Medication[],
  doseEvents: DoseEvent[],
  now: Date,
): PatientMedicationSummaryRow[] {
  return medications.map((medication) => {
    const scheduleInfo = describeSchedule(medication)
    const schedule = calculateMedicationSchedule(medication, doseEvents, now)

    return {
      medicationId: medication.id,
      name: medication.name,
      strengthText: medication.strengthText,
      defaultDoseText: medication.defaultDoseText,
      scheduleType: scheduleInfo.type,
      scheduleDetails: scheduleInfo.details,
      lastGiven: schedule.lastGivenAt
        ? formatAbsoluteDateTime(schedule.lastGivenAt)
        : 'Never taken',
      nextEligible: formatAbsoluteDateTime(schedule.nextEligibleAt),
      currentStatus: describeCurrentStatus(
        medication,
        now,
        schedule.eligibleNow,
        schedule.tooEarlyByMinutes,
        schedule.overdueByMinutes,
      ),
      reminderSetting:
        medication.reminderSettings?.enabled
          ? `Enabled${medication.reminderSettings.earlyReminderMinutes ? ` (${medication.reminderSettings.earlyReminderMinutes} min early)` : ''}`
          : 'Disabled',
    }
  })
}

export function buildPatientSummaryText(
  patient: Patient,
  generatedAt: Date,
  rows: PatientMedicationSummaryRow[],
): string {
  const headerLines = [
    'Nexpill Patient Medication Summary',
    'Includes active medications only.',
    `Patient: ${patient.displayName}`,
    `Generated: ${formatAbsoluteDateTime(generatedAt)}`,
    '',
  ]

  const medicationLines = rows.flatMap((row, index) => [
    `${index + 1}. ${row.name}`,
    `   Strength: ${row.strengthText ?? 'N/A'}`,
    `   Default dose: ${row.defaultDoseText ?? 'N/A'}`,
    `   Schedule type: ${row.scheduleType}`,
    `   Schedule details: ${row.scheduleDetails}`,
    `   Last given: ${row.lastGiven}`,
    `   Next eligible: ${row.nextEligible}`,
    `   Current status: ${row.currentStatus}`,
    `   Reminder: ${row.reminderSetting}`,
    '',
  ])

  return [...headerLines, ...medicationLines].join('\n').trimEnd()
}
