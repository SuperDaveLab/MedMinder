import { useMemo, useState } from 'react'
import type { Medication } from '../../domain/types'
import type { DoseEvent, MedicationStatusLabel } from '../../domain/types'
import {
  formatAbsoluteDateTime,
  formatDurationMinutesCompact,
  formatRelativeTime,
} from '../time'

interface MedicationCardProps {
  medication: Medication
  statusLabel: MedicationStatusLabel
  statusText: string
  lastGivenAt: Date | null
  nextEligibleAt: Date
  now: Date
  medicationDoseEvents: DoseEvent[]
  actionsDisabled: boolean
  patientNotificationsEnabled: boolean
  onLogDose: (medicationId: string) => void
  onCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    doseText?: string,
    notes?: string,
  ) => Promise<void>
  onDeleteDose: (doseEventId: string) => Promise<void>
  onToggleReminderEnabled: (medication: Medication, enabled: boolean) => Promise<void>
}

function renderScheduleLabel(medication: Medication): string {
  if (medication.schedule.type === 'interval') {
    return `Fixed interval: every ${formatDurationMinutesCompact(medication.schedule.intervalMinutes)}`
  }

  if (medication.schedule.type === 'prn') {
    return `PRN lockout: ${formatDurationMinutesCompact(medication.schedule.minimumIntervalMinutes)} minimum`
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
  patientNotificationsEnabled,
  onLogDose,
  onCorrectDose,
  onDeleteDose,
  onToggleReminderEnabled,
}: MedicationCardProps) {
  const [editingDoseEventId, setEditingDoseEventId] = useState<string | null>(null)
  const [replacementTimestampInput, setReplacementTimestampInput] = useState('')
  const [correctionDoseText, setCorrectionDoseText] = useState('')
  const [correctionNotes, setCorrectionNotes] = useState('')
  const [isSavingCorrection, setIsSavingCorrection] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [isReminderToggleInProgress, setIsReminderToggleInProgress] = useState(false)
  const [reminderToggleError, setReminderToggleError] = useState<string | null>(null)

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

  const recentDoseEvents = useMemo(
    () =>
      medicationDoseEvents
        .filter((doseEvent) => !supersededDoseEventIds.has(doseEvent.id))
        .slice(0, 5),
    [medicationDoseEvents, supersededDoseEventIds],
  )

  const latestDisplayedDoseEvent = recentDoseEvents[0]
  const reminderEnabled = Boolean(medication.reminderSettings?.enabled)

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
    setCorrectionDoseText(doseEvent.doseText ?? medication.defaultDoseText)
    setCorrectionNotes('')
    setCorrectionError(null)
  }

  const cancelCorrection = () => {
    setEditingDoseEventId(null)
    setReplacementTimestampInput('')
    setCorrectionDoseText('')
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
        correctionDoseText.trim() || undefined,
        correctionNotes.trim() || undefined,
      )
      cancelCorrection()
    } catch {
      setCorrectionError('Unable to save correction. Please try again.')
    } finally {
      setIsSavingCorrection(false)
    }
  }

  const deleteDose = async (doseEventId: string) => {
    const confirmed = window.confirm('Delete this dose entry? This cannot be undone.')

    if (!confirmed) {
      return
    }

    setCorrectionError(null)

    try {
      await onDeleteDose(doseEventId)
      if (editingDoseEventId === doseEventId) {
        cancelCorrection()
      }
    } catch {
      setCorrectionError('Unable to delete dose. Please try again.')
    }
  }

  const handleReminderToggle = async (enabled: boolean) => {
    if (isReminderToggleInProgress || actionsDisabled) {
      return
    }

    setReminderToggleError(null)
    setIsReminderToggleInProgress(true)

    try {
      await onToggleReminderEnabled(medication, enabled)
    } catch {
      setReminderToggleError('Unable to update reminder setting right now.')
    } finally {
      setIsReminderToggleInProgress(false)
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
          {patientNotificationsEnabled ? (
            <label className="med-card-reminder-toggle">
              <input
                type="checkbox"
                checked={reminderEnabled}
                disabled={actionsDisabled || isReminderToggleInProgress}
                onChange={(event) => void handleReminderToggle(event.target.checked)}
                data-testid={`care-reminder-toggle-${medication.id}`}
              />
              <span className="toggle-switch-track" aria-hidden="true">
                <span className="toggle-switch-thumb" />
              </span>
              <span>{reminderEnabled ? 'Notifications on' : 'Notifications off'}</span>
            </label>
          ) : null}
          <p className="dose-label">Default dose: {medication.defaultDoseText}</p>
          <p className="schedule-label">{renderScheduleLabel(medication)}</p>
        </div>
        <div className="med-card-actions">
          <span className="status-pill">{statusText}</span>
          <button
            onClick={() => onLogDose(medication.id)}
            className="dose-button card-dose-button"
            disabled={actionsDisabled}
          >
            Give Dose
          </button>
        </div>
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
      {reminderToggleError ? <p className="correction-error">{reminderToggleError}</p> : null}
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
                <div className="med-history-primary-row">
                  <div className="med-history-time">
                    <strong>{formatAbsoluteDateTime(new Date(doseEvent.timestampGiven))}</strong>
                    <span>{formatRelativeTime(new Date(doseEvent.timestampGiven), now)}</span>
                  </div>
                  {!supersededDoseEventIds.has(doseEvent.id) ? (
                    <div className="dose-entry-actions">
                      <button
                        type="button"
                        className="correct-button inline-edit-trigger"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={() => startCorrection(doseEvent)}
                        data-testid={`correct-dose-${doseEvent.id}`}
                        aria-label="Edit dose entry"
                      >
                        <span className="inline-edit-icon" aria-hidden="true">✎</span>
                        <span className="inline-edit-label">Edit</span>
                      </button>
                      <button
                        type="button"
                        className="correct-button inline-edit-trigger"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={() => void deleteDose(doseEvent.id)}
                        data-testid={`delete-dose-${doseEvent.id}`}
                        aria-label="Delete dose entry"
                      >
                        <span className="inline-edit-icon" aria-hidden="true">🗑</span>
                        <span className="inline-edit-label">Delete</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="entry-tags">
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
                  <div className="correction-meta-row">
                    <span className="entry-tag" data-testid={`entry-tag-corrected-${doseEvent.id}`}>
                      Corrected
                    </span>
                    <span className="correction-supersedes-label">
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
                  </div>
                ) : null}
                {!doseEvent.corrected && correctionBySupersededId.has(doseEvent.id) ? (
                  <span>
                    Superseded by correction at{' '}
                    {formatAbsoluteDateTime(
                      new Date(correctionBySupersededId.get(doseEvent.id)?.timestampGiven ?? doseEvent.timestampGiven),
                    )}
                  </span>
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
                      Dose amount
                      <input
                        type="text"
                        aria-label="Dose amount"
                        value={correctionDoseText}
                        onChange={(event) => setCorrectionDoseText(event.target.value)}
                        placeholder="e.g. 25mg or 50mg"
                      />
                    </label>
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
                        className="correct-save-button icon-action-button"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={() => void saveCorrection(doseEvent.id)}
                        aria-label="Save correction"
                      >
                        {isSavingCorrection ? 'Saving...' : <span className="icon-action-glyph" aria-hidden="true">✔</span>}
                      </button>
                      <button
                        type="button"
                        className="correct-cancel-button icon-action-button"
                        disabled={actionsDisabled || isSavingCorrection}
                        onClick={cancelCorrection}
                        aria-label="Cancel correction"
                      >
                        <span className="icon-action-glyph" aria-hidden="true">X</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
