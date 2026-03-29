import type { Medication } from '../../domain/types'
import type { DoseEvent, MedicationStatusLabel } from '../../domain/types'

interface MedicationCardProps {
  medication: Medication
  statusLabel: MedicationStatusLabel
  statusText: string
  lastGivenAt: Date | null
  nextEligibleAt: Date
  recentDoseEvents: DoseEvent[]
  onLogDose: (medicationId: string) => void
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(value)
}

function renderScheduleLabel(medication: Medication): string {
  if (medication.schedule.type === 'interval') {
    return `Fixed interval: every ${medication.schedule.intervalMinutes / 60}h`
  }

  if (medication.schedule.type === 'prn') {
    return `PRN lockout: ${medication.schedule.minimumIntervalMinutes / 60}h minimum`
  }

  if (medication.schedule.type === 'fixed_times') {
    return `Fixed times: ${medication.schedule.timesOfDay.join(', ')}`
  }

  return `Taper plan: ${medication.schedule.rules.length} rules`
}

export function MedicationCard({
  medication,
  statusLabel,
  statusText,
  lastGivenAt,
  nextEligibleAt,
  recentDoseEvents,
  onLogDose,
}: MedicationCardProps) {
  return (
    <article
      className="med-card"
      data-status={statusLabel}
      data-testid={`med-card-${medication.id}`}
    >
      <div className="med-card-top">
        <div>
          <h3>{medication.name}</h3>
          <p className="dose-label">Default dose: {medication.defaultDoseText}</p>
          <p className="schedule-label">{renderScheduleLabel(medication)}</p>
        </div>
        <span className="status-pill">{statusText}</span>
      </div>
      <p className="last-given">
        Last given:{' '}
        <strong>{lastGivenAt ? formatDateTime(lastGivenAt) : 'Never taken'}</strong>
      </p>
      <p className="next-eligible">
        Next eligible: <strong>{formatDateTime(nextEligibleAt)}</strong>
      </p>
      {medication.instructions ? (
        <p className="instructions">{medication.instructions}</p>
      ) : null}
      <div className="med-history-block">
        <h4>Recent doses</h4>
        {recentDoseEvents.length === 0 ? (
          <p className="med-history-empty">No doses logged yet.</p>
        ) : (
          <ul className="med-history-list" data-testid={`med-history-${medication.id}`}>
            {recentDoseEvents.map((doseEvent) => (
              <li key={doseEvent.id} className="med-history-item">
                <strong>{new Date(doseEvent.timestampGiven).toLocaleString()}</strong>
                {doseEvent.doseText ? <span>Dose: {doseEvent.doseText}</span> : null}
                {doseEvent.givenBy ? <span>Given by: {doseEvent.givenBy}</span> : null}
                {doseEvent.notes ? <span>Notes: {doseEvent.notes}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={() => onLogDose(medication.id)} className="dose-button">
        Give Dose
      </button>
    </article>
  )
}
