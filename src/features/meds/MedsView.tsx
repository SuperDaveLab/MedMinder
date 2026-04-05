import { useState } from 'react'
import {
  getMedicationScheduleTypeLabel,
  medicationScheduleTypeOptions,
} from '../../domain/types'
import type {
  LocalDateString,
  Medication,
  MedicationSchedule,
  MedicationScheduleType,
  TimeOfDayHHmm,
} from '../../domain/types'
import {
  createMedication,
  deactivateMedication,
  deleteMedicationCascade,
  updateMedication,
} from '../../storage/repository'
import {
  durationMinutesToValue,
  durationValueToMinutes,
} from '../../ui/time'

interface MedsViewProps {
  selectedPatientId: string | null
  medicationsForAdministration: Medication[]
  onDataChanged: (preferredPatientId?: string | null) => Promise<void>
  onUiError: (message: string | null) => void
}

const medicationDurationUnits: Array<'minutes' | 'hours'> = ['minutes', 'hours']

function chooseMedicationDurationUnit(totalMinutes: number): 'minutes' | 'hours' {
  if (totalMinutes > 0 && totalMinutes % 60 === 0) {
    return 'hours'
  }

  return 'minutes'
}

function getDurationInputStep(unit: 'minutes' | 'hours'): number {
  return unit === 'hours' ? 0.25 : 15
}

function getDurationInputMin(unit: 'minutes' | 'hours'): number {
  return unit === 'hours' ? 0.25 : 15
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

function createDefaultFixedTimes(): TimeOfDayHHmm[] {
  return ['08:00', '20:00']
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
  const [scheduleTypeInput, setScheduleTypeInput] = useState<MedicationScheduleType>('interval')
  const [intervalValueInput, setIntervalValueInput] = useState('8')
  const [intervalUnitInput, setIntervalUnitInput] = useState<'minutes' | 'hours'>('hours')
  const [fixedTimesInput, setFixedTimesInput] = useState<TimeOfDayHHmm[]>(createDefaultFixedTimes)
  const [prnMinimumIntervalValueInput, setPrnMinimumIntervalValueInput] = useState('6')
  const [prnMinimumIntervalUnitInput, setPrnMinimumIntervalUnitInput] = useState<'minutes' | 'hours'>('hours')
  const [taperRulesInput, setTaperRulesInput] = useState('')
  const [reminderEnabledInput, setReminderEnabledInput] = useState(true)
  const [reminderMinutesInput, setReminderMinutesInput] = useState<'0' | '10' | '15'>('0')
  const [alarmEnabledInput, setAlarmEnabledInput] = useState(false)
  const [medicationFormError, setMedicationFormError] = useState<string | null>(null)
  const [isMedicationActionInProgress, setIsMedicationActionInProgress] = useState(false)

  const supportsAlarmForSchedule =
    scheduleTypeInput === 'interval' || scheduleTypeInput === 'fixed_times'

  const parseDurationMinutes = (
    rawValue: string,
    unit: 'minutes' | 'hours',
    errorMessage: string,
  ): number | null => {
    const durationValue = Number.parseFloat(rawValue)

    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      setMedicationFormError(errorMessage)
      return null
    }

    const totalMinutes = durationValueToMinutes(durationValue, unit)

    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
      setMedicationFormError(errorMessage)
      return null
    }

    return totalMinutes
  }

  const updateFixedTimeInput = (index: number, value: string) => {
    setFixedTimesInput((current) =>
      current.map((timeValue, timeIndex) =>
        timeIndex === index ? value : timeValue,
      ) as TimeOfDayHHmm[],
    )
  }

  const addFixedTimeInput = () => {
    setFixedTimesInput((current) => [...current, '12:00'])
  }

  const removeFixedTimeInput = (index: number) => {
    setFixedTimesInput((current) => {
      if (current.length <= 1) {
        return current
      }

      return current.filter((_, timeIndex) => timeIndex !== index)
    })
  }

  const buildMedicationScheduleFromForm = (): MedicationSchedule | null => {
    if (scheduleTypeInput === 'interval') {
      const intervalMinutes = parseDurationMinutes(
        intervalValueInput,
        intervalUnitInput,
        'Interval must be a positive number.',
      )

      if (intervalMinutes === null) {
        return null
      }

      return {
        type: 'interval',
        intervalMinutes,
      }
    }

    if (scheduleTypeInput === 'fixed_times') {
      const times = fixedTimesInput
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
      const minimumIntervalMinutes = parseDurationMinutes(
        prnMinimumIntervalValueInput,
        prnMinimumIntervalUnitInput,
        'PRN minimum interval must be a positive number.',
      )

      if (minimumIntervalMinutes === null) {
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
      const intervalUnit = chooseMedicationDurationUnit(medication.schedule.intervalMinutes)
      setIntervalUnitInput(intervalUnit)
      setIntervalValueInput(durationMinutesToValue(medication.schedule.intervalMinutes, intervalUnit))
    }

    if (medication.schedule.type === 'fixed_times') {
      setFixedTimesInput(medication.schedule.timesOfDay)
    }

    if (medication.schedule.type === 'prn') {
      const prnUnit = chooseMedicationDurationUnit(medication.schedule.minimumIntervalMinutes)
      setPrnMinimumIntervalUnitInput(prnUnit)
      setPrnMinimumIntervalValueInput(
        durationMinutesToValue(medication.schedule.minimumIntervalMinutes, prnUnit),
      )
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
    setIntervalValueInput('8')
    setIntervalUnitInput('hours')
    setFixedTimesInput(createDefaultFixedTimes())
    setPrnMinimumIntervalValueInput('6')
    setPrnMinimumIntervalUnitInput('hours')
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
            onChange={(event) => setScheduleTypeInput(event.target.value as MedicationScheduleType)}
          >
            {medicationScheduleTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {getMedicationScheduleTypeLabel(option.value)}
              </option>
            ))}
          </select>
        </label>
        {scheduleTypeInput === 'interval' ? (
          <div className="duration-input-row">
            <label>
              Interval
              <input
                data-testid="interval-value-input"
                type="number"
                min={getDurationInputMin(intervalUnitInput)}
                step={getDurationInputStep(intervalUnitInput)}
                value={intervalValueInput}
                onChange={(event) => setIntervalValueInput(event.target.value)}
              />
            </label>
            <label>
              Unit
              <select
                data-testid="interval-unit-select"
                value={intervalUnitInput}
                onChange={(event) => setIntervalUnitInput(event.target.value as 'minutes' | 'hours')}
              >
                {medicationDurationUnits.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {scheduleTypeInput === 'fixed_times' ? (
          <div className="fixed-times-editor" data-testid="fixed-times-editor">
            <div className="fixed-times-editor-header">
              <span>Specific times</span>
              <button
                type="button"
                className="utility-button"
                data-testid="add-fixed-time-button"
                onClick={addFixedTimeInput}
              >
                Add time
              </button>
            </div>
            <p className="fixed-times-help">Use one time per dose window. Quarter-hour steps keep entry simple.</p>
            <div className="fixed-times-list">
              {fixedTimesInput.map((timeValue, index) => (
                <div key={`${index}-${timeValue}`} className="fixed-time-row">
                  <label>
                    <span>Time {index + 1}</span>
                    <input
                      data-testid={`fixed-time-input-${index}`}
                      type="time"
                      step={900}
                      value={timeValue}
                      onChange={(event) => updateFixedTimeInput(index, event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="utility-button"
                    data-testid={`remove-fixed-time-button-${index}`}
                    disabled={fixedTimesInput.length <= 1}
                    onClick={() => removeFixedTimeInput(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {scheduleTypeInput === 'prn' ? (
          <div className="duration-input-row">
            <label>
              Minimum interval
              <input
                data-testid="prn-minimum-interval-value-input"
                type="number"
                min={getDurationInputMin(prnMinimumIntervalUnitInput)}
                step={getDurationInputStep(prnMinimumIntervalUnitInput)}
                value={prnMinimumIntervalValueInput}
                onChange={(event) => setPrnMinimumIntervalValueInput(event.target.value)}
              />
            </label>
            <label>
              Unit
              <select
                data-testid="prn-minimum-interval-unit-select"
                value={prnMinimumIntervalUnitInput}
                onChange={(event) => setPrnMinimumIntervalUnitInput(event.target.value as 'minutes' | 'hours')}
              >
                {medicationDurationUnits.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </label>
          </div>
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
