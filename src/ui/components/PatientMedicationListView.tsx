import { useMemo } from 'react'
import type {
  DoseEvent,
  Medication,
  MedicationStatusLabel,
  Patient,
} from '../../domain/types'
import { computeMedicationStatus } from '../../engine/contract'
import { MedicationCard } from './MedicationCard'

interface PatientMedicationListViewProps {
  patient: Patient
  medications: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  actionsDisabled?: boolean
  onAddMedication?: () => void
  onGiveDose: (medicationId: string) => void
  onCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
  onToggleMedicationReminder: (medication: Medication, enabled: boolean) => Promise<void>
}

interface StatusDescriptor {
  label: MedicationStatusLabel
  text: string
}

function describeStatus(status: ReturnType<typeof computeMedicationStatus>): StatusDescriptor {
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

  if (status.statusLabel === 'missed') {
    return {
      label: 'missed',
      text: `Missed by: ${formatDuration(status.overdueByMinutes ?? 0)}`,
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

export function PatientMedicationListView({
  patient,
  medications,
  doseEvents,
  now,
  actionsDisabled,
  onAddMedication,
  onGiveDose,
  onCorrectDose,
  onToggleMedicationReminder,
}: PatientMedicationListViewProps) {
  const medicationStatuses = useMemo(
    () =>
      medications.map((medication) => ({
        medication,
        status: computeMedicationStatus({ medication, doseEvents, now }),
      })),
    [medications, doseEvents, now],
  )

  return (
    <section className="medication-section">
      <div className="medication-section-header">
        <h2 aria-label={patient.displayName}>{patient.displayName}'s medications</h2>
        <button
          type="button"
          className="utility-button medication-add-button"
          data-testid="care-add-medication-button"
          aria-label="Add medication"
          onClick={onAddMedication}
        >
          <span className="button-label-mobile" aria-hidden="true">+</span>
          <span className="button-label-desktop">Add medication</span>
        </button>
      </div>
      {medicationStatuses.length === 0 ? (
        <p className="med-list-empty">No active medications for this patient yet.</p>
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
              onToggleReminderEnabled={onToggleMedicationReminder}
            />
          )
        })}
      </div>
    </section>
  )
}
