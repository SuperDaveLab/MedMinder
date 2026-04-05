import { type ChangeEvent, useRef, useState } from 'react'
import type { DoseEvent, Medication, Patient } from '../../domain/types'
import {
  createPatient,
  deletePatientCascade,
  exportFullBackup,
  importFullBackup,
  updatePatient,
} from '../../storage/repository'
import { validateBackup } from '../../storage/backup'
import {
  buildPatientMedicationSummaryRows,
  buildPatientSummaryText,
} from '../../export/patientSummary'
import { formatAbsoluteDateTime } from '../../ui/time'

interface MoreViewProps {
  noPatientsMode?: boolean
  patients: Patient[]
  selectedPatientId: string | null
  patient: Patient | null
  medicationsForPatient: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  onDataChanged: (preferredPatientId?: string | null) => Promise<void>
  onUiError: (message: string | null) => void
  notificationPermission: NotificationPermission | 'unsupported'
  requestNotificationPermission: () => Promise<void>
  installPromptAvailable: boolean
  isInstalled: boolean
  onInstallApp: () => Promise<void>
  wakeLockSupported: boolean
  isWakeLockActive: boolean
  onToggleWakeLock: () => Promise<void>
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  downloadLink.click()
  URL.revokeObjectURL(objectUrl)
}

export function MoreView({
  noPatientsMode = false,
  patients,
  selectedPatientId,
  patient,
  medicationsForPatient,
  doseEvents,
  now,
  onDataChanged,
  onUiError,
  notificationPermission,
  requestNotificationPermission,
  installPromptAvailable,
  isInstalled,
  onInstallApp,
  wakeLockSupported,
  isWakeLockActive,
  onToggleWakeLock,
}: MoreViewProps) {
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null)
  const [patientDisplayNameInput, setPatientDisplayNameInput] = useState('')
  const [patientNotesInput, setPatientNotesInput] = useState('')
  const [patientFormError, setPatientFormError] = useState<string | null>(null)
  const [isPatientActionInProgress, setIsPatientActionInProgress] = useState(false)

  const [isBackupActionInProgress, setIsBackupActionInProgress] = useState(false)
  const [backupStatusMessage, setBackupStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const backupFileInputRef = useRef<HTMLInputElement>(null)

  const summaryRows = patient
    ? buildPatientMedicationSummaryRows(
        medicationsForPatient,
        doseEvents,
        now,
      )
    : []

  const resetPatientForm = () => {
    setEditingPatientId(null)
    setPatientDisplayNameInput('')
    setPatientNotesInput('')
    setPatientFormError(null)
  }

  const startEditPatient = (listedPatient: Patient) => {
    setEditingPatientId(listedPatient.id)
    setPatientDisplayNameInput(listedPatient.displayName)
    setPatientNotesInput(listedPatient.notes ?? '')
    setPatientFormError(null)
  }

  const handleSavePatient = async () => {
    if (isPatientActionInProgress) {
      return
    }

    const displayName = patientDisplayNameInput.trim()

    if (!displayName) {
      setPatientFormError('Patient display name is required.')
      return
    }

    try {
      onUiError(null)
      setPatientFormError(null)
      setIsPatientActionInProgress(true)

      if (editingPatientId) {
        await updatePatient(editingPatientId, {
          displayName,
          notes: patientNotesInput,
        })
        await onDataChanged(editingPatientId)
      } else {
        const createdPatient = await createPatient({
          displayName,
          notes: patientNotesInput,
        })
        await onDataChanged(createdPatient.id)
      }

      resetPatientForm()
    } catch (error) {
      setPatientFormError(
        error instanceof Error
          ? error.message
          : 'Unable to save patient right now.',
      )
    } finally {
      setIsPatientActionInProgress(false)
    }
  }

  const handleDeletePatient = async (patientId: string) => {
    if (isPatientActionInProgress) {
      return
    }

    const confirmed = window.confirm(
      'Permanently delete this patient and all associated medications and dose events?\n\nThis action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    try {
      onUiError(null)
      setIsPatientActionInProgress(true)
      await deletePatientCascade(patientId)
      await onDataChanged(patientId === selectedPatientId ? null : selectedPatientId)

      if (editingPatientId === patientId) {
        resetPatientForm()
      }
    } catch {
      onUiError('Unable to delete patient right now. Please try again.')
    } finally {
      setIsPatientActionInProgress(false)
    }
  }

  const handlePrintSummary = () => {
    window.print()
  }

  const handleExportSummary = () => {
    if (!patient) {
      return
    }

    const summaryText = buildPatientSummaryText(patient, now, summaryRows)
    const fileName = `${patient.displayName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-medication-summary-${now.toISOString().slice(0, 10)}.txt`
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, fileName)
  }

  const handleShareSummary = async () => {
    if (!patient) {
      return
    }

    const summaryText = buildPatientSummaryText(patient, now, summaryRows)
    const fileName = `${patient.displayName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-medication-summary-${now.toISOString().slice(0, 10)}.txt`

    if (typeof navigator.share !== 'function') {
      handleExportSummary()
      return
    }

    try {
      const summaryFile = new File([summaryText], fileName, { type: 'text/plain;charset=utf-8' })
      if (navigator.canShare?.({ files: [summaryFile] })) {
        await navigator.share({
          title: `${patient.displayName} medication summary`,
          files: [summaryFile],
        })
      } else {
        await navigator.share({
          title: `${patient.displayName} medication summary`,
          text: summaryText,
        })
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        handleExportSummary()
      }
    }
  }

  const handleExportBackup = async () => {
    if (isBackupActionInProgress) return
    setIsBackupActionInProgress(true)
    setBackupStatusMessage(null)
    try {
      const backup = await exportFullBackup()
      const json = JSON.stringify(backup, null, 2)
      const fileName = `med-minder-backup-${new Date().toISOString().slice(0, 10)}.json`
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      downloadBlob(blob, fileName)
      setBackupStatusMessage({ kind: 'success', text: 'Backup exported successfully.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setBackupStatusMessage({ kind: 'error', text: `Export failed: ${message}` })
    } finally {
      setIsBackupActionInProgress(false)
    }
  }

  const handleShareBackup = async () => {
    if (isBackupActionInProgress) return

    if (typeof navigator.share !== 'function') {
      await handleExportBackup()
      return
    }

    setIsBackupActionInProgress(true)
    setBackupStatusMessage(null)
    try {
      const backup = await exportFullBackup()
      const json = JSON.stringify(backup, null, 2)
      const fileName = `med-minder-backup-${new Date().toISOString().slice(0, 10)}.json`
      const backupFile = new File([json], fileName, { type: 'application/json;charset=utf-8' })

      if (navigator.canShare?.({ files: [backupFile] })) {
        await navigator.share({
          title: 'Med-Minder backup',
          files: [backupFile],
        })
        setBackupStatusMessage({ kind: 'success', text: 'Backup shared successfully.' })
      } else {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
        downloadBlob(blob, fileName)
        setBackupStatusMessage({
          kind: 'success',
          text: 'Native share not available for backup files on this device. Backup downloaded.',
        })
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setBackupStatusMessage({ kind: 'error', text: 'Unable to share backup right now.' })
      }
    } finally {
      setIsBackupActionInProgress(false)
    }
  }

  const handleImportBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (isBackupActionInProgress) return
    setBackupStatusMessage(null)

    let text: string
    try {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (readerEvent) => resolve(readerEvent.target?.result as string)
        reader.onerror = () => reject(new Error('Could not read file.'))
        reader.readAsText(file)
      })
    } catch {
      setBackupStatusMessage({ kind: 'error', text: 'Could not read selected backup file.' })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      setBackupStatusMessage({ kind: 'error', text: 'The selected file is not valid JSON.' })
      return
    }

    const result = validateBackup(parsed)
    if (!result.valid) {
      setBackupStatusMessage({ kind: 'error', text: `Invalid backup: ${result.error}` })
      return
    }

    const { backup } = result
    const confirmed = window.confirm(
      `Import this backup and replace all current local data?\n\n` +
        `- ${String(backup.patients.length)} patient(s)\n` +
        `- ${String(backup.medications.length)} medication(s)\n` +
        `- ${String(backup.doseEvents.length)} dose event(s)\n` +
        `- Exported: ${backup.exportedAt}\n\n` +
        `This action cannot be undone.`,
    )
    if (!confirmed) return

    setIsBackupActionInProgress(true)
    try {
      await importFullBackup(backup)
      await onDataChanged(null)
      setBackupStatusMessage({ kind: 'success', text: 'Backup restored successfully.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setBackupStatusMessage({ kind: 'error', text: `Import failed: ${message}` })
    } finally {
      setIsBackupActionInProgress(false)
    }
  }

  const patientSection = (
    <section className="admin-section no-print">
      <h2>{noPatientsMode ? 'Patient administration' : 'Patient records'}</h2>
      <label>
        Patient display name
        <input
          data-testid="patient-display-name-input"
          type="text"
          value={patientDisplayNameInput}
          onChange={(event) => setPatientDisplayNameInput(event.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          data-testid="patient-notes-input"
          value={patientNotesInput}
          onChange={(event) => setPatientNotesInput(event.target.value)}
        />
      </label>
      {patientFormError ? <p className="form-error">{patientFormError}</p> : null}
      <div className="form-actions">
        <button
          data-testid="save-patient-button"
          className="utility-button"
          disabled={isPatientActionInProgress}
          onClick={() => void handleSavePatient()}
        >
          {isPatientActionInProgress
            ? 'Saving...'
            : noPatientsMode
              ? 'Add patient'
              : editingPatientId
                ? 'Save patient'
                : 'Add patient'}
        </button>
        {!noPatientsMode && editingPatientId ? (
          <button className="utility-button" disabled={isPatientActionInProgress} onClick={resetPatientForm}>Cancel</button>
        ) : null}
      </div>
      {!noPatientsMode ? (
        <ul className="admin-list">
          {patients.map((listedPatient) => (
            <li key={listedPatient.id} className="admin-item" data-testid={`patient-item-${listedPatient.id}`}>
              <div>
                <strong>{listedPatient.displayName}</strong>
                {listedPatient.notes ? <p>{listedPatient.notes}</p> : null}
              </div>
              <div className="admin-item-actions">
                <button
                  data-testid={`edit-patient-${listedPatient.id}`}
                  className="utility-button"
                  disabled={isPatientActionInProgress}
                  onClick={() => startEditPatient(listedPatient)}
                >
                  Edit
                </button>
                <button
                  data-testid={`delete-patient-${listedPatient.id}`}
                  className="utility-button danger-button"
                  disabled={isPatientActionInProgress}
                  onClick={() => void handleDeletePatient(listedPatient.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )

  if (noPatientsMode) {
    return patientSection
  }

  return (
    <>
      <section className="workflow-section" data-testid="more-view">
        <section className="admin-section no-print app-settings-section">
          <h2>App Settings</h2>
          <div className="app-actions">
            <button
              className="utility-button"
              onClick={() => void requestNotificationPermission()}
              disabled={notificationPermission !== 'default'}
            >
              {notificationPermission === 'granted'
                ? 'Notifications enabled'
                : notificationPermission === 'unsupported'
                  ? 'Notifications unsupported'
                  : notificationPermission === 'denied'
                    ? 'Notifications denied'
                    : 'Enable due alerts'}
            </button>
            <button
              className="utility-button"
              onClick={() => void onInstallApp()}
              disabled={!installPromptAvailable || isInstalled}
              data-testid="install-app-button"
            >
              {isInstalled ? 'App Installed' : installPromptAvailable ? 'Install App' : 'Install Unavailable'}
            </button>
            <button
              className="utility-button"
              onClick={() => void onToggleWakeLock()}
              disabled={!wakeLockSupported}
              data-testid="wake-lock-button"
            >
              {isWakeLockActive ? 'Sleep lock: ON' : 'Prevent sleep'}
            </button>
          </div>
          <p className="subhead">
            {isInstalled
              ? 'Already installed.'
              : installPromptAvailable
                ? 'Install available.'
                : 'Install not available.'}
          </p>
          <p className="subhead">
            {isWakeLockActive
              ? 'Screen wake lock on.'
              : wakeLockSupported
                ? 'Wake lock available.'
                : 'Wake lock unsupported.'}
          </p>
        </section>

        {patientSection}

        <section className="admin-section no-print" data-testid="backup-section">
          <h2>Backup and restore</h2>
          <p className="subhead">
            Export a local backup of all patients, medications, and dose history. Import to fully
            restore from a previous backup - this replaces all current data.
          </p>
          {backupStatusMessage ? (
            <p className={backupStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
              {backupStatusMessage.text}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              className="utility-button"
              disabled={isBackupActionInProgress}
              onClick={() => void handleExportBackup()}
              data-testid="export-backup-button"
            >
              {isBackupActionInProgress ? 'Working...' : 'Export backup JSON'}
            </button>
            <button
              className="utility-button"
              disabled={isBackupActionInProgress}
              onClick={() => void handleShareBackup()}
              data-testid="share-backup-button"
            >
              Share backup
            </button>
            <button
              className="utility-button"
              disabled={isBackupActionInProgress}
              onClick={() => backupFileInputRef.current?.click()}
              data-testid="import-backup-button"
            >
              Import backup JSON...
            </button>
          </div>
          <input
            ref={backupFileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(event) => void handleImportBackup(event)}
            data-testid="backup-file-input"
          />
        </section>
      </section>

      <section className="workflow-section" data-testid="summary-section">
        <section className="summary-section print-summary">
          <div className="app-actions no-print">
            <button className="utility-button" onClick={handlePrintSummary}>
              Print summary
            </button>
            <button className="utility-button" onClick={handleExportSummary}>
              Export summary (.txt)
            </button>
            <button className="utility-button" onClick={() => void handleShareSummary()} data-testid="share-summary-button">
              Share summary
            </button>
          </div>
          <h2>Patient medication summary</h2>
          <p className="summary-meta">Patient: {patient?.displayName ?? ''}</p>
          <p className="summary-meta">Generated: {formatAbsoluteDateTime(now)}</p>
          <ul className="summary-list">
            {summaryRows.map((row) => (
              <li key={row.medicationId} className="summary-item">
                <h3>{row.name}</h3>
                <p>Strength: {row.strengthText ?? 'N/A'}</p>
                <p>Default dose: {row.defaultDoseText ?? 'N/A'}</p>
                <p>Schedule type: {row.scheduleType}</p>
                <p>Schedule details: {row.scheduleDetails}</p>
                <p>Last given: {row.lastGiven}</p>
                <p>Next eligible: {row.nextEligible}</p>
                <p>Current status: {row.currentStatus}</p>
                <p>Reminder: {row.reminderSetting}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </>
  )
}
