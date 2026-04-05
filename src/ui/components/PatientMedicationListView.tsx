import { useMemo } from 'react'
import type {
  DoseEvent,
  Medication,
  MedicationStatus,
  MedicationStatusLabel,
  Patient,
} from '../../domain/types'
import { calculateMedicationSchedule } from '../../engine/scheduling'
import { MedicationCard } from './MedicationCard'

interface PatientMedicationListViewProps {
  patient: Patient
  medications: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  actionsDisabled?: boolean
  onGiveDose: (medicationId: string) => void
  onCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
}

interface StatusDescriptor {
  label: MedicationStatusLabel
  text: string
}

function describeStatus(status: MedicationStatus): StatusDescriptor {
  if (status.statusLabel === 'available_prn') {
    return { label: 'available_prn', text: 'Available now' }
  }

  if (status.statusLabel === 'never_taken') {
    return { label: 'never_taken', text: 'Never taken' }
  }

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins} mins`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m === 0 ? `${h} hr` : `${h} hr ${m} mins`
  }

  const nextLabel = status.scheduleType === 'prn' ? 'Next available:' : 'Next due:'

  if (status.statusLabel === 'too_early') {
    return {
      label: 'too_early',
      text: `${nextLabel} ${formatDuration(status.minutesUntilEligible ?? 0)}`,
    }
  }

  if (status.statusLabel === 'overdue') {
    return {
      label: 'overdue',
      text: `Overdue by: ${formatDuration(status.overdueByMinutes ?? 0)}`,
    }
  }

  if (status.statusLabel === 'due_soon') {
    return {
      label: 'due_soon',
      text: `${nextLabel} ${formatDuration(status.minutesUntilEligible ?? 0)}`,
    }
  }

  return { label: 'eligible_now', text: 'Eligible now' }
}

function buildMedicationStatus(
  medication: Medication,
  doseEvents: DoseEvent[],
  now: Date,
): MedicationStatus {
  const scheduleResult = calculateMedicationSchedule(medication, doseEvents, now)
  const minutesUntilEligible = Math.max(
    0,
    Math.ceil((scheduleResult.nextEligibleAt.getTime() - now.getTime()) / 60_000),
  )

  let statusLabel: MedicationStatusLabel

  if (!scheduleResult.lastGivenAt) {
    statusLabel = 'never_taken'
  } else if (medication.schedule.type === 'prn' && scheduleResult.eligibleNow) {
    statusLabel = 'available_prn'
  } else if (!scheduleResult.eligibleNow) {
    statusLabel = minutesUntilEligible <= 20 ? 'due_soon' : 'too_early'
  } else if ((scheduleResult.overdueByMinutes ?? 0) > 0) {
    statusLabel = 'overdue'
  } else {
    statusLabel = 'eligible_now'
  }

  return {
    scheduleType: medication.schedule.type,
    lastGivenAt: scheduleResult.lastGivenAt?.toISOString(),
    nextEligibleAt: scheduleResult.nextEligibleAt.toISOString(),
    eligibleNow: scheduleResult.eligibleNow,
    minutesUntilEligible,
    tooEarlyByMinutes: scheduleResult.tooEarlyByMinutes ?? undefined,
    overdueByMinutes: scheduleResult.overdueByMinutes ?? undefined,
    reminderAt: scheduleResult.reminderAt?.toISOString(),
    statusLabel,
  }
}

export function PatientMedicationListView({
  patient,
  medications,
  doseEvents,
  now,
  actionsDisabled,
  onGiveDose,
  onCorrectDose,
}: PatientMedicationListViewProps) {
  const medicationStatuses = useMemo(
    () =>
      medications.map((medication) => ({
        medication,
        status: buildMedicationStatus(medication, doseEvents, now),
      })),
    [medications, doseEvents, now],
  )

  return (
    <section className="medication-section">
      <h2>{patient.displayName}'s medications</h2>
      {medicationStatuses.length === 0 ? (
        <p className="med-list-empty">No active medications for this patient. Add one in Admin.</p>
      ) : null}
      <div className="medication-list">
        {medicationStatuses.map(({ medication, status }) => {
          const descriptor = describeStatus(status)
          const medicationDoseEvents = doseEvents
            .filter((doseEvent) => doseEvent.medicationId === medication.id)
            .sort((a, b) => b.timestampGiven.localeCompare(a.timestampGiven))

          return (
            <MedicationCard
              key={medication.id}
              medication={medication}
              statusLabel={descriptor.label}
              statusText={descriptor.text}
              lastGivenAt={status.lastGivenAt ? new Date(status.lastGivenAt) : null}
              nextEligibleAt={new Date(status.nextEligibleAt ?? now.toISOString())}
              now={now}
              medicationDoseEvents={medicationDoseEvents}
              actionsDisabled={Boolean(actionsDisabled)}
              onLogDose={onGiveDose}
              onCorrectDose={onCorrectDose}
            />
          )
        })}
      </div>
    </section>
  )
}
