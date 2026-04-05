import type { DoseEvent, Medication, Patient } from '../../domain/types'
import { PatientMedicationListView } from '../../ui/components/PatientMedicationListView'
import { formatAbsoluteDateTime, formatRelativeTime } from '../../ui/time'

interface CareViewProps {
  patient: Patient
  medicationsForPatient: Medication[]
  allMedications: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  onGiveDose: (medicationId: string) => Promise<void>
  onCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
  actionsDisabled: boolean
}

export function CareView({
  patient,
  medicationsForPatient,
  allMedications,
  doseEvents,
  now,
  onGiveDose,
  onCorrectDose,
  actionsDisabled,
}: CareViewProps) {
  const medicationById = new Map(allMedications.map((medication) => [medication.id, medication.name]))
  const correctionBySupersededId = new Map(
    doseEvents
      .filter((doseEvent) => doseEvent.corrected)
      .map((doseEvent) => [doseEvent.supersedesDoseEventId, doseEvent]),
  )
  const patientMedicationIds = new Set(
    allMedications
      .filter((medication) => medication.patientId === patient.id)
      .map((medication) => medication.id),
  )
  const recentHistory = [...doseEvents]
    .filter((doseEvent) => patientMedicationIds.has(doseEvent.medicationId) && !correctionBySupersededId.has(doseEvent.id))
    .sort((a, b) => b.timestampGiven.localeCompare(a.timestampGiven))
    .slice(0, 12)

  return (
    <section className="workflow-section" data-testid="care-view">
      <section className="care-layout">
        <PatientMedicationListView
          patient={patient}
          medications={medicationsForPatient}
          doseEvents={doseEvents}
          now={now}
          onGiveDose={onGiveDose}
          onCorrectDose={onCorrectDose}
          actionsDisabled={actionsDisabled}
        />
        <section className="history-section care-history-section" data-testid="care-recent-history">
          <h2>Recent dose history</h2>
          <ul className="history-list compact-history-list">
            {recentHistory.length === 0 ? (
              <li className="history-item history-item-empty">No doses logged yet.</li>
            ) : (
              recentHistory.slice(0, 8).map((entry) => (
                <li key={entry.id} className="history-item compact-history-item">
                  <div>
                    <strong>{medicationById.get(entry.medicationId) ?? 'Unknown medication'}</strong>
                    <div className="history-tags">
                      {entry.corrected ? <span className="entry-tag">Corrected</span> : null}
                      {!entry.corrected && correctionBySupersededId.has(entry.id)
                        ? <span className="entry-tag entry-tag-muted">Superseded</span>
                        : null}
                    </div>
                  </div>
                  <span>
                    {formatAbsoluteDateTime(new Date(entry.timestampGiven))} ({formatRelativeTime(new Date(entry.timestampGiven), now)})
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </section>
    </section>
  )
}
