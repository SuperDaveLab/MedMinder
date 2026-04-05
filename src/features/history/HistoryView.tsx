import type { DoseEvent, Medication, Patient } from '../../domain/types'
import { formatRelativeTime } from '../../ui/time'

interface HistoryViewProps {
  patient: Patient
  medications: Medication[]
  doseEvents: DoseEvent[]
  now: Date
}

export function HistoryView({ patient, medications, doseEvents, now }: HistoryViewProps) {
  const medicationById = new Map(medications.map((medication) => [medication.id, medication.name]))
  const correctionBySupersededId = new Map(
    doseEvents
      .filter((doseEvent) => doseEvent.corrected)
      .map((doseEvent) => [doseEvent.supersedesDoseEventId, doseEvent]),
  )

  const patientMedIds = new Set(
    medications
      .filter((medication) => medication.patientId === patient.id)
      .map((medication) => medication.id),
  )
  const allPatientDoses = doseEvents
    .filter((doseEvent) => patientMedIds.has(doseEvent.medicationId))
    .sort((a, b) => b.timestampGiven.localeCompare(a.timestampGiven))

  const groupedHistory = new Map<string, DoseEvent[]>()
  for (const dose of allPatientDoses) {
    const date = new Date(dose.timestampGiven)
    const dateStr = date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (!groupedHistory.has(dateStr)) {
      groupedHistory.set(dateStr, [])
    }
    groupedHistory.get(dateStr)?.push(dose)
  }

  return (
    <section className="workflow-section" data-testid="history-view">
      <section className="history-section">
        <h2>All dose history for {patient.displayName}</h2>
        {allPatientDoses.length === 0 ? (
          <ul className="history-list">
            <li className="history-item history-item-empty">No doses logged yet.</li>
          </ul>
        ) : (
          Array.from(groupedHistory.entries()).map(([dateStr, entries]) => (
            <div key={dateStr} className="history-date-group" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.65rem', color: 'var(--brand)' }}>{dateStr}</h3>
              <ul className="history-list">
                {entries.map((entry) => (
                  <li key={entry.id} className="history-item">
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
                      {new Date(entry.timestampGiven).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ({formatRelativeTime(new Date(entry.timestampGiven), now)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </section>
  )
}
