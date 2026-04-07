import { useState } from 'react'
import type { Patient } from '../../domain/types'
import type { UpsertPatientInput } from '../../storage/repository'

interface PatientsViewProps {
  noPatientsMode?: boolean
  patients: Patient[]
  onDataChanged: (preferredPatientId?: string | null) => Promise<void>
  onUiError: (message: string | null) => void
  onCreatePatient: (displayName: string, notes?: string) => Promise<void>
  onUpdatePatient: (patientId: string, input: UpsertPatientInput) => Promise<void>
  onDeletePatient: (patientId: string) => Promise<void>
}

export function PatientsView({
  noPatientsMode = false,
  patients,
  onDataChanged,
  onUiError,
  onCreatePatient,
  onUpdatePatient,
  onDeletePatient,
}: PatientsViewProps) {
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null)
  const [patientDisplayNameInput, setPatientDisplayNameInput] = useState('')
  const [patientNotesInput, setPatientNotesInput] = useState('')
  const [patientFormError, setPatientFormError] = useState<string | null>(null)
  const [isPatientActionInProgress, setIsPatientActionInProgress] = useState(false)
  const [isPatientFormOpen, setIsPatientFormOpen] = useState(false)

  const resetPatientForm = () => {
    setEditingPatientId(null)
    setPatientDisplayNameInput('')
    setPatientNotesInput('')
    setPatientFormError(null)
  }

  const closePatientForm = () => {
    resetPatientForm()
    setIsPatientFormOpen(false)
  }

  const togglePatientForm = () => {
    if (isPatientFormOpen) {
      closePatientForm()
      return
    }

    resetPatientForm()
    setIsPatientFormOpen(true)
  }

  const startEditPatient = (listedPatient: Patient) => {
    setIsPatientFormOpen(true)
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
        await onUpdatePatient(editingPatientId, {
          displayName,
          notes: patientNotesInput,
        })
        await onDataChanged(editingPatientId)
      } else {
        await onCreatePatient(displayName, patientNotesInput)
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
      await onDeletePatient(patientId)

      if (editingPatientId === patientId) {
        resetPatientForm()
      }
    } catch {
      onUiError('Unable to delete patient right now. Please try again.')
    } finally {
      setIsPatientActionInProgress(false)
    }
  }

  return (
    <section className="workflow-section" data-testid="patients-view">
      <section className="admin-section no-print">
        <h2>{noPatientsMode ? 'Patient administration' : 'Patient management'}</h2>
        <div className="form-actions patients-toolbar">
          <button
            type="button"
            data-testid="start-add-patient-button"
            className="utility-button"
            disabled={isPatientActionInProgress}
            onClick={togglePatientForm}
          >
            {isPatientFormOpen ? 'Close patient form' : 'Add patient'}
          </button>
        </div>
        {isPatientFormOpen ? (
          <section className="patients-form-panel" data-testid="patient-form-panel">
            <h3>{editingPatientId ? 'Edit patient' : 'New patient'}</h3>
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
                  : editingPatientId
                    ? 'Save patient'
                    : 'Save new patient'}
              </button>
              <button
                type="button"
                className="utility-button"
                disabled={isPatientActionInProgress}
                onClick={closePatientForm}
              >
                Cancel
              </button>
            </div>
          </section>
        ) : null}
        {!noPatientsMode ? (
          <section className="patients-list-panel" data-testid="patient-list-panel">
            <h3>Patient list</h3>
            <ul className="admin-list">
              {patients.length === 0 ? (
                <li className="admin-item admin-item-empty">No patients yet.</li>
              ) : null}
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
          </section>
        ) : null}
      </section>
    </section>
  )
}
