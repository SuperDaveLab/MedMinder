import { useMemo, useState } from 'react'
import type { Medication } from '../../domain/types'
import type { DoseEvent, MedicationStatusLabel } from '../../domain/types'
import { formatAbsoluteDateTime, formatRelativeTime } from '../time'

interface MedicationCardProps {
  medication: Medication
  statusLabel: MedicationStatusLabel
  statusText: string
  lastGivenAt: Date | null
  nextEligibleAt: Date
  now: Date
  medicationDoseEvents: DoseEvent[]
  actionsDisabled: boolean
  onLogDose: (medicationId: string) => void
  onCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
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

function toDateTimeLocalValue(isoDateString: string): string {
  const date = new Date(isoDateString)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (value: number): string => String(value).padStart(2, '0')

  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('')
}

export function MedicationCard({
  medication,
  statusLabel,
  statusText,
  lastGivenAt,
  nextEligibleAt,
  now,
  medicationDoseEvents,
  actionsDisabled,
  onLogDose,
  onCorrectDose,
}: MedicationCardProps) {
  const [editingDoseEventId, setEditingDoseEventId] = useState<string | null>(null)
  const [replacementTimestampInput, setReplacementTimestampInput] = useState('')
  const [correctionNotes, setCorrectionNotes] = useState('')
  const [isSavingCorrection, setIsSavingCorrection] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)

  const recentDoseEvents = useMemo(
    () => medicationDoseEvents.slice(0, 5),
    [medicationDoseEvents],
  )

  const supersededDoseEventIds = useMemo(
    () =>
      new Set(
        medicationDoseEvents
          .filter((doseEvent) => doseEvent.corrected)
          .map((doseEvent) => doseEvent.supersedesDoseEventId),
      ),
    [medicationDoseEvents],
  )

  const correctionBySupersededId = useMemo(
    () =>
      new Map(
        medicationDoseEvents
          .filter((doseEvent) => doseEvent.corrected)
          .map((doseEvent) => [doseEvent.supersedesDoseEventId, doseEvent]),
      ),
    [medicationDoseEvents],
  )

  const latestDisplayedDoseEvent = recentDoseEvents[0]

  const latestDisplayedTrustText = latestDisplayedDoseEvent
    ? latestDisplayedDoseEvent.corrected
      ? 'Most recent displayed event is a correction.'
      : supersededDoseEventIds.has(latestDisplayedDoseEvent.id)
        ? 'Most recent displayed event has been superseded by a correction.'
        : 'Most recent displayed event is an original entry.'
    : 'No recent events yet.'

  const startCorrection = (doseEvent: DoseEvent) => {
    setEditingDoseEventId(doseEvent.id)
    setReplacementTimestampInput(toDateTimeLocalValue(doseEvent.timestampGiven))
    setCorrectionNotes('')
    setCorrectionError(null)
  }

  const cancelCorrection = () => {
    setEditingDoseEventId(null)
    setReplacementTimestampInput('')
    setCorrectionNotes('')
    setCorrectionError(null)
  }

  const saveCorrection = async (doseEventId: string) => {
    if (!replacementTimestampInput) {
      setCorrectionError('Replacement timestamp (local time) is required.')
      return
    }

    const replacementDate = new Date(replacementTimestampInput)

    if (Number.isNaN(replacementDate.getTime())) {
      setCorrectionError('Enter a valid replacement timestamp.')
      return
    }

    setCorrectionError(null)

    const confirmed = window.confirm(
      'Save this correction? The original entry will remain in history and be marked superseded.',
    )

    if (!confirmed) {
      return
    }

    setIsSavingCorrection(true)

    try {
      await onCorrectDose(
        doseEventId,
        replacementDate.toISOString(),
        correctionNotes.trim() || undefined,
      )
      cancelCorrection()
    } catch {
      setCorrectionError('Unable to save correction. Please try again.')
    } finally {
      setIsSavingCorrection(false)
    }
  }

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
        <strong>
          {lastGivenAt
            ? `${formatAbsoluteDateTime(lastGivenAt)} (${formatRelativeTime(lastGivenAt, now)})`
            : 'Never taken'}
        </strong>
      </p>
      <p className="next-eligible">
        Next eligible:{' '}
        <strong>
          {formatAbsoluteDateTime(nextEligibleAt)} ({formatRelativeTime(nextEligibleAt, now)})
        </strong>
      </p>
      <p className="last-event-trust">{latestDisplayedTrustText}</p>
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
              <li
                key={doseEvent.id}
                className="med-history-item"
                data-testid={`dose-entry-${doseEvent.id}`}
              >
                <strong>{formatAbsoluteDateTime(new Date(doseEvent.timestampGiven))}</strong>
                <span>{formatRelativeTime(new Date(doseEvent.timestampGiven), now)}</span>
                <div className="entry-tags">
                  {doseEvent.corrected ? (
                    <span className="entry-tag" data-testid={`entry-tag-corrected-${doseEvent.id}`}>
                      Corrected
                    </span>
                  ) : null}
                  {!doseEvent.corrected && supersededDoseEventIds.has(doseEvent.id) ? (
                    <span className="entry-tag entry-tag-muted" data-testid={`entry-tag-superseded-${doseEvent.id}`}>
                      Superseded
                    </span>
                  ) : null}
                </div>
                {doseEvent.doseText ? <span>Dose: {doseEvent.doseText}</span> : null}
                {doseEvent.givenBy ? <span>Given by: {doseEvent.givenBy}</span> : null}
                {doseEvent.notes ? <span>Notes: {doseEvent.notes}</span> : null}
                {doseEvent.corrected ? (
                  <span>
                    Supersedes:{' '}
                    {doseEvent.supersedesDoseEventId && correctionBySupersededId.has(doseEvent.supersedesDoseEventId)
                      ? formatAbsoluteDateTime(
                          new Date(
                            medicationDoseEvents.find(
                              (entry) => entry.id === doseEvent.supersedesDoseEventId,
                            )?.timestampGiven ?? doseEvent.timestampGiven,
                          ),
                        )
                      : doseEvent.supersedesDoseEventId}
                  </span>
                ) : null}
                {!doseEvent.corrected && correctionBySupersededId.has(doseEvent.id) ? (
                  <span>
                    Superseded by correction at{' '}
                    {formatAbsoluteDateTime(
                      new Date(correctionBySupersededId.get(doseEvent.id)?.timestampGiven ?? doseEvent.timestampGiven),
                    )}
                  </span>
                ) : null}
                {!doseEvent.corrected && !supersededDoseEventIds.has(doseEvent.id) ? (
                  <div className="correction-actions">
                    <button
                      type="button"
                      className="correct-button"
                      disabled={actionsDisabled || isSavingCorrection}
                      onClick={() => startCorrection(doseEvent)}
                      data-testid={`correct-dose-${doseEvent.id}`}
                    >
                      Correct
                    </button>
                  </div>
                ) : null}
                {editingDoseEventId === doseEvent.id ? (
                  <div className="correction-form" data-testid={`correction-form-${doseEvent.id}`}>
                    <label>
                      Replacement timestamp (local time)
                      <input
                        type="datetime-local"
                        aria-label="Replacement timestamp (local time)"
                        value={replacementTimestampInput}
                        onChange={(event) => setReplacementTimestampInput(event.target.value)}
                        required
                      />
                    </label>
                    <p className="correction-helper">
                      Uses your device local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                    </p>
                    <label>
                      Notes (optional)
                      <input
                        type="text"
                        aria-label="Notes (optional)"
                        value={correctionNotes}
                        onChange={(event) => setCorrectionNotes(event.target.value)}
                        placeholder="Why this correction was needed"
                      />
                    </label>
                    {correctionError ? <p className="correction-error">{correctionError}</p> : null}
                    <div className="correction-form-actions">
                      <button
                        type="button"
                        className="correct-save-button"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={() => void saveCorrection(doseEvent.id)}
                      >
                        {isSavingCorrection ? 'Saving...' : 'Save correction'}
                      </button>
                      <button
                        type="button"
                        className="correct-cancel-button"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={cancelCorrection}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={() => onLogDose(medication.id)}
        className="dose-button"
        disabled={actionsDisabled}
      >
        Give Dose
      </button>
    </article>
  )
}
