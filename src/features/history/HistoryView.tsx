import { useState } from 'react'
import type { AuthSessionState } from '../../domain/auth'
import type { DoseEvent, Medication, Patient } from '../../domain/types'
import { formatRelativeTime } from '../../ui/time'
import { buildDoseHistoryCsv, buildDoseHistoryRows } from '../../export/doseHistoryCsv'

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  downloadLink.click()
  URL.revokeObjectURL(objectUrl)
}

interface HistoryViewProps {
  patient: Patient
  medications: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  authState: AuthSessionState | null
  onEmailExport: (payload: { filename: string; content: string; mimeType: string }) => Promise<void>
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function buildLocalDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatLocalDayLabel(dayKey: string): string {
  const [yearLabel, monthLabel, dayLabel] = dayKey.split('-')
  const year = Number.parseInt(yearLabel, 10)
  const month = Number.parseInt(monthLabel, 10) - 1
  const day = Number.parseInt(dayLabel, 10)

  return new Date(year, month, day).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function HistoryView({ patient, medications, doseEvents, now, authState, onEmailExport }: HistoryViewProps) {
  const [shareStatusMessage, setShareStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const medicationById = new Map(medications.map((medication) => [medication.id, medication.name]))

  function buildCsvExport(): { filename: string; csv: string } {
    const rows = buildDoseHistoryRows([patient], medications, doseEvents)
    const csv = buildDoseHistoryCsv(rows)
    const dateSlug = new Date().toISOString().slice(0, 10)
    const nameSlug = patient.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    return { filename: `med-minder-${nameSlug}-dose-history-${dateSlug}.csv`, csv }
  }

  function handleExportCsv() {
    const { filename, csv } = buildCsvExport()
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
  }

  async function handleShareCsv() {
    if (isSharing) return
    setIsSharing(true)
    setShareStatusMessage(null)
    try {
      const { filename, csv } = buildCsvExport()
      await onEmailExport({ filename, content: csv, mimeType: 'text/csv' })
      setShareStatusMessage({ kind: 'success', text: `Dose history emailed to ${authState?.account.email ?? 'your account'}.` })
    } catch {
      setShareStatusMessage({ kind: 'error', text: 'Unable to email dose history right now.' })
    } finally {
      setIsSharing(false)
    }
  }

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
    .sort((a, b) => toTimestamp(b.timestampGiven) - toTimestamp(a.timestampGiven))

  const groupedHistory = new Map<string, DoseEvent[]>()
  for (const dose of allPatientDoses) {
    const dayKey = buildLocalDayKey(toTimestamp(dose.timestampGiven))
    if (!groupedHistory.has(dayKey)) {
      groupedHistory.set(dayKey, [])
    }
    groupedHistory.get(dayKey)?.push(dose)
  }

  const orderedDayKeys = Array.from(groupedHistory.keys()).sort((a, b) => b.localeCompare(a))

  return (
    <section className="workflow-section" data-testid="history-view">
      <section className="history-section">
        <div className="history-section-header">
          <h2>All dose history for {patient.displayName}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="utility-button"
              onClick={handleExportCsv}
              data-testid="export-dose-history-button"
            >
              Export CSV
            </button>
            {authState ? (
              <button
                className="utility-button"
                disabled={isSharing}
                onClick={() => void handleShareCsv()}
                data-testid="share-dose-history-button"
              >
                {isSharing ? 'Sending...' : `Email CSV to ${authState.account.email}`}
              </button>
            ) : null}
          </div>
          {shareStatusMessage ? (
            <p style={{ margin: 0, fontSize: '0.85rem', color: shareStatusMessage.kind === 'error' ? '#991b1b' : '#166534' }}>
              {shareStatusMessage.text}
            </p>
          ) : null}
        </div>
        {allPatientDoses.length === 0 ? (
          <ul className="history-list">
            <li className="history-item history-item-empty">No doses logged yet.</li>
          </ul>
        ) : (
          orderedDayKeys.map((dayKey) => (
            <div key={dayKey} className="history-date-group" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.65rem', color: 'var(--brand)' }}>{formatLocalDayLabel(dayKey)}</h3>
              <ul className="history-list">
                {groupedHistory.get(dayKey)?.map((entry) => (
                  <li key={entry.id} className="history-item">
                    <div>
                      <strong>{medicationById.get(entry.medicationId) ?? 'Unknown medication'}</strong>
                      <div className="history-tags">
                        {entry.corrected ? <span className="entry-tag">Corrected</span> : null}
                        {!entry.corrected && correctionBySupersededId.has(entry.id)
                          ? <span className="entry-tag entry-tag-muted">Superseded</span>
                          : null}
                        {entry.doseText ? <span className="entry-tag entry-tag-dose">{entry.doseText}</span> : null}
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
