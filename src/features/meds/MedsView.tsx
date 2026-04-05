import { useState } from 'react'
import type { LocalDateString, Medication, MedicationSchedule, TimeOfDayHHmm } from '../../domain/types'
import {
  createMedication,
  deactivateMedication,
  deleteMedicationCascade,
  updateMedication,
} from '../../storage/repository'

interface MedsViewProps {
  selectedPatientId: string | null
  medicationsForAdministration: Medication[]
  onDataChanged: (preferredPatientId?: string | null) => Promise<void>
  onUiError: (message: string | null) => void
}

function isLocalDateString(value: string): value is LocalDateString {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isTimeOfDayHHmm(value: string): value is TimeOfDayHHmm {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false
  }

  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function scheduleToTaperText(schedule: MedicationSchedule): string {
  if (schedule.type !== 'taper') {
    return ''
  }

  return schedule.rules
    .map((rule) => `${rule.startDate},${rule.endDate ?? ''},${rule.intervalMinutes}`)
    .join('\n')
}

export function MedsView({
  selectedPatientId,
  medicationsForAdministration,
  onDataChanged,
  onUiError,
}: MedsViewProps) {
  const [editingMedicationId, setEditingMedicationId] = useState<string | null>(null)
  const [medicationNameInput, setMedicationNameInput] = useState('')
  const [medicationStrengthInput, setMedicationStrengthInput] = useState('')
  const [medicationDefaultDoseInput, setMedicationDefaultDoseInput] = useState('')
  const [medicationInstructionsInput, setMedicationInstructionsInput] = useState('')
  const [scheduleTypeInput, setScheduleTypeInput] = useState<MedicationSchedule['type']>('interval')
  const [intervalMinutesInput, setIntervalMinutesInput] = useState('480')
  const [fixedTimesInput, setFixedTimesInput] = useState('08:00, 20:00')
  const [prnMinimumIntervalInput, setPrnMinimumIntervalInput] = useState('360')
  const [taperRulesInput, setTaperRulesInput] = useState('')
  const [reminderEnabledInput, setReminderEnabledInput] = useState(true)
  const [reminderMinutesInput, setReminderMinutesInput] = useState<'0' | '10' | '15'>('0')
  const [alarmEnabledInput, setAlarmEnabledInput] = useState(false)
  const [medicationFormError, setMedicationFormError] = useState<string | null>(null)
  const [isMedicationActionInProgress, setIsMedicationActionInProgress] = useState(false)

  const supportsAlarmForSchedule =
    scheduleTypeInput === 'interval' || scheduleTypeInput === 'fixed_times'

  const buildMedicationScheduleFromForm = (): MedicationSchedule | null => {
    if (scheduleTypeInput === 'interval') {
      const intervalMinutes = Number.parseInt(intervalMinutesInput, 10)

      if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
        setMedicationFormError('Interval minutes must be a positive number.')
        return null
      }

      return {
        type: 'interval',
        intervalMinutes,
      }
    }

    if (scheduleTypeInput === 'fixed_times') {
      const times = fixedTimesInput
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)

      if (times.length === 0) {
        setMedicationFormError('Provide at least one fixed time in HH:mm format.')
        return null
      }

      if (!times.every((time) => isTimeOfDayHHmm(time))) {
        setMedicationFormError('Fixed times must use HH:mm format.')
        return null
      }

      return {
        type: 'fixed_times',
        timesOfDay: times,
      }
    }

    if (scheduleTypeInput === 'prn') {
      const minimumIntervalMinutes = Number.parseInt(prnMinimumIntervalInput, 10)

      if (!Number.isFinite(minimumIntervalMinutes) || minimumIntervalMinutes <= 0) {
        setMedicationFormError('PRN minimum interval must be a positive number.')
        return null
      }

      return {
        type: 'prn',
        minimumIntervalMinutes,
      }
    }

    const lines = taperRulesInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length === 0) {
      setMedicationFormError('Provide at least one taper rule line.')
      return null
    }

    const rules = lines.map((line) => {
      const [startDateRaw, endDateRaw, intervalRaw] = line.split(',').map((value) => value.trim())
      const intervalMinutes = Number.parseInt(intervalRaw ?? '', 10)

      if (!startDateRaw || !isLocalDateString(startDateRaw)) {
        throw new Error('Each taper rule needs a valid start date (YYYY-MM-DD).')
      }

      if (endDateRaw && !isLocalDateString(endDateRaw)) {
        throw new Error('Taper end date must be YYYY-MM-DD when provided.')
      }

      if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
        throw new Error('Taper interval must be a positive number.')
      }

      return {
        startDate: startDateRaw,
        endDate: endDateRaw || undefined,
        intervalMinutes,
      }
    })

    return {
      type: 'taper',
      rules,
    }
  }

  const startEditMedication = (medication: Medication) => {
    setEditingMedicationId(medication.id)
    setMedicationNameInput(medication.name)
    setMedicationStrengthInput(medication.strengthText ?? '')
    setMedicationDefaultDoseInput(medication.defaultDoseText)
    setMedicationInstructionsInput(medication.instructions ?? '')
    setScheduleTypeInput(medication.schedule.type)
    setMedicationFormError(null)

    if (medication.schedule.type === 'interval') {
      setIntervalMinutesInput(String(medication.schedule.intervalMinutes))
    }

    if (medication.schedule.type === 'fixed_times') {
      setFixedTimesInput(medication.schedule.timesOfDay.join(', '))
    }

    if (medication.schedule.type === 'prn') {
      setPrnMinimumIntervalInput(String(medication.schedule.minimumIntervalMinutes))
    }

    if (medication.schedule.type === 'taper') {
      setTaperRulesInput(scheduleToTaperText(medication.schedule))
    }

    setReminderEnabledInput(Boolean(medication.reminderSettings?.enabled))
    setReminderMinutesInput(String(medication.reminderSettings?.earlyReminderMinutes ?? 0) as '0' | '10' | '15')
    setAlarmEnabledInput(Boolean(medication.reminderSettings?.alarmEnabled))
  }

  const resetMedicationForm = () => {
    setEditingMedicationId(null)
    setMedicationNameInput('')
    setMedicationStrengthInput('')
    setMedicationDefaultDoseInput('')
    setMedicationInstructionsInput('')
    setScheduleTypeInput('interval')
    setIntervalMinutesInput('480')
    setFixedTimesInput('08:00, 20:00')
    setPrnMinimumIntervalInput('360')
    setTaperRulesInput('')
    setReminderEnabledInput(true)
    setReminderMinutesInput('0')
    setAlarmEnabledInput(false)
    setMedicationFormError(null)
  }

  const handleSaveMedication = async () => {
    if (isMedicationActionInProgress) {
      return
    }

    if (!selectedPatientId) {
      setMedicationFormError('Select or create a patient first.')
      return
    }

    if (!medicationNameInput.trim() || !medicationDefaultDoseInput.trim()) {
      setMedicationFormError('Medication name and default dose are required.')
      return
    }

    let schedule: MedicationSchedule | null = null

    try {
      schedule = buildMedicationScheduleFromForm()
    } catch (error) {
      setMedicationFormError(
        error instanceof Error
          ? error.message
          : 'Unable to parse schedule input.',
      )
      return
    }

    if (!schedule) {
      return
    }

    const existingMedication = editingMedicationId
      ? medicationsForAdministration.find((medication) => medication.id === editingMedicationId)
      : null

    const reminderSettings = {
      enabled: reminderEnabledInput,
      ...(reminderEnabledInput
        ? {
            earlyReminderMinutes: Number.parseInt(reminderMinutesInput, 10) as 0 | 10 | 15,
          }
        : {}),
      ...(supportsAlarmForSchedule ? { alarmEnabled: alarmEnabledInput } : {}),
    }

    const medicationInput = {
      patientId: selectedPatientId,
      name: medicationNameInput,
      strengthText: medicationStrengthInput,
      instructions: medicationInstructionsInput,
      defaultDoseText: medicationDefaultDoseInput,
      active: existingMedication?.active ?? true,
      schedule,
      reminderSettings,
    }

    try {
      onUiError(null)
      setMedicationFormError(null)
      setIsMedicationActionInProgress(true)

      if (editingMedicationId) {
        await updateMedication(editingMedicationId, medicationInput)
      } else {
        await createMedication(medicationInput)
      }

      await onDataChanged(selectedPatientId)
      resetMedicationForm()
    } catch (error) {
      setMedicationFormError(
        error instanceof Error
          ? error.message
          : 'Unable to save medication right now.',
      )
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  const handleDeactivateMedication = async (medicationId: string) => {
    if (isMedicationActionInProgress) {
      return
    }

    try {
      onUiError(null)
      setIsMedicationActionInProgress(true)
      await deactivateMedication(medicationId)
      await onDataChanged(selectedPatientId)
    } catch {
      onUiError('Unable to deactivate medication right now. Please try again.')
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  const handleDeleteMedication = async (medicationId: string) => {
    if (isMedicationActionInProgress) {
      return
    }

    const confirmed = window.confirm(
      'Permanently delete this medication and all associated dose events?\n\nThis action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    try {
      onUiError(null)
      setIsMedicationActionInProgress(true)
      await deleteMedicationCascade(medicationId)
      await onDataChanged(selectedPatientId)

      if (editingMedicationId === medicationId) {
        resetMedicationForm()
      }
    } catch {
      onUiError('Unable to delete medication right now. Please try again.')
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  return (
    <section className="workflow-section" data-testid="meds-view">
      <section className="admin-section no-print">
        <h2>Medication records</h2>
        <label>
          Medication name
          <input
            data-testid="medication-name-input"
            type="text"
            value={medicationNameInput}
            onChange={(event) => setMedicationNameInput(event.target.value)}
          />
        </label>
        <label>
          Strength (optional)
          <input
            data-testid="medication-strength-input"
            type="text"
            value={medicationStrengthInput}
            onChange={(event) => setMedicationStrengthInput(event.target.value)}
          />
        </label>
        <label>
          Default dose
          <input
            data-testid="medication-default-dose-input"
            type="text"
            value={medicationDefaultDoseInput}
            onChange={(event) => setMedicationDefaultDoseInput(event.target.value)}
          />
        </label>
        <label>
          Instructions (optional)
          <textarea
            data-testid="medication-instructions-input"
            value={medicationInstructionsInput}
            onChange={(event) => setMedicationInstructionsInput(event.target.value)}
          />
        </label>
        <label>
          Schedule type
          <select
            data-testid="medication-schedule-type-select"
            value={scheduleTypeInput}
            onChange={(event) => setScheduleTypeInput(event.target.value as MedicationSchedule['type'])}
          >
            <option value="interval">interval</option>
            <option value="fixed_times">fixed_times</option>
            <option value="prn">prn</option>
            <option value="taper">taper</option>
          </select>
        </label>
        {scheduleTypeInput === 'interval' ? (
          <label>
            Interval minutes
            <input
              data-testid="interval-minutes-input"
              type="number"
              min={1}
              value={intervalMinutesInput}
              onChange={(event) => setIntervalMinutesInput(event.target.value)}
            />
          </label>
        ) : null}
        {scheduleTypeInput === 'fixed_times' ? (
          <label>
            Fixed times (comma-separated HH:mm)
            <input
              data-testid="fixed-times-input"
              type="text"
              value={fixedTimesInput}
              onChange={(event) => setFixedTimesInput(event.target.value)}
            />
          </label>
        ) : null}
        {scheduleTypeInput === 'prn' ? (
          <label>
            Minimum interval minutes
            <input
              data-testid="prn-minimum-interval-input"
              type="number"
              min={1}
              value={prnMinimumIntervalInput}
              onChange={(event) => setPrnMinimumIntervalInput(event.target.value)}
            />
          </label>
        ) : null}
        {scheduleTypeInput === 'taper' ? (
          <label>
            Taper rules (one per line: startDate,endDate,intervalMinutes)
            <textarea
              data-testid="taper-rules-input"
              value={taperRulesInput}
              onChange={(event) => setTaperRulesInput(event.target.value)}
            />
          </label>
        ) : null}
        <label className="checkbox-row">
          <input
            data-testid="reminder-enabled-input"
            type="checkbox"
            checked={reminderEnabledInput}
            onChange={(event) => setReminderEnabledInput(event.target.checked)}
          />
          Enable reminders
        </label>
        {reminderEnabledInput ? (
          <label>
            Reminder minutes early
            <select
              data-testid="reminder-minutes-select"
              value={reminderMinutesInput}
              onChange={(event) => setReminderMinutesInput(event.target.value as '0' | '10' | '15')}
            >
              <option value="0">0</option>
              <option value="10">10</option>
              <option value="15">15</option>
            </select>
          </label>
        ) : null}
        {supportsAlarmForSchedule ? (
          <label className="checkbox-row">
            <input
              data-testid="alarm-enabled-input"
              type="checkbox"
              checked={alarmEnabledInput}
              onChange={(event) => setAlarmEnabledInput(event.target.checked)}
            />
            Enable in-app alarm (sound/vibration when due now)
          </label>
        ) : null}
        {medicationFormError ? <p className="form-error">{medicationFormError}</p> : null}
        <div className="form-actions">
          <button
            data-testid="save-medication-button"
            className="utility-button"
            disabled={isMedicationActionInProgress}
            onClick={() => void handleSaveMedication()}
          >
            {isMedicationActionInProgress
              ? 'Saving...'
              : editingMedicationId
                ? 'Save medication'
                : 'Add medication'}
          </button>
          {editingMedicationId ? (
            <button className="utility-button" disabled={isMedicationActionInProgress} onClick={resetMedicationForm}>Cancel</button>
          ) : null}
        </div>
        <ul className="admin-list">
          {medicationsForAdministration.length === 0 ? (
            <li className="admin-item admin-item-empty">No medications for this patient yet.</li>
          ) : null}
          {medicationsForAdministration.map((medication) => (
            <li key={medication.id} className="admin-item" data-testid={`medication-item-${medication.id}`}>
              <div>
                <strong>{medication.name}</strong>
                <p>{medication.active ? 'Active' : 'Inactive'}</p>
              </div>
              <div className="admin-item-actions">
                <button
                  data-testid={`edit-medication-${medication.id}`}
                  className="utility-button"
                  disabled={isMedicationActionInProgress}
                  onClick={() => startEditMedication(medication)}
                >
                  Edit
                </button>
                {medication.active ? (
                  <button
                    data-testid={`deactivate-medication-${medication.id}`}
                    className="utility-button"
                    disabled={isMedicationActionInProgress}
                    onClick={() => void handleDeactivateMedication(medication.id)}
                  >
                    Deactivate
                  </button>
                ) : null}
                <button
                  data-testid={`delete-medication-${medication.id}`}
                  className="utility-button danger-button"
                  disabled={isMedicationActionInProgress}
                  onClick={() => void handleDeleteMedication(medication.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
