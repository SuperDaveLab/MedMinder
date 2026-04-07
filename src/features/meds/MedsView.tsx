import { useEffect, useRef, useState } from 'react'
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
  Patient,
  DoseEvent,
} from '../../domain/types'
import type { UpsertMedicationInput } from '../../storage/repository'
import {
  durationMinutesToValue,
  durationValueToMinutes,
} from '../../ui/time'
import {
  buildPatientMedicationSummaryRows,
  buildPatientSummaryText,
} from '../../export/patientSummary'
import { formatAbsoluteDateTime } from '../../ui/time'

interface MedsViewProps {
  openMedicationFormRequestId?: number
  onOpenMedicationFormHandled?: () => void
  selectedPatientId: string | null
  patientDisplayName: string | null
  patient: Patient | null
  medicationsForAdministration: Medication[]
  doseEvents: DoseEvent[]
  now: Date
  onCreateMedication: (input: UpsertMedicationInput) => Promise<void>
  onUpdateMedication: (medicationId: string, input: UpsertMedicationInput) => Promise<void>
  onActivateMedication: (medicationId: string) => Promise<void>
  onDeactivateMedication: (medicationId: string) => Promise<void>
  onDeleteMedication: (medicationId: string) => Promise<void>
  onToggleMedicationReminder: (medication: Medication, enabled: boolean) => Promise<void>
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

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  downloadLink.click()
  URL.revokeObjectURL(objectUrl)
}

export function MedsView({
  openMedicationFormRequestId,
  onOpenMedicationFormHandled,
  selectedPatientId,
  patientDisplayName,
  patient,
  medicationsForAdministration,
  doseEvents,
  now,
  onCreateMedication,
  onUpdateMedication,
  onActivateMedication,
  onDeactivateMedication,
  onDeleteMedication,
  onToggleMedicationReminder,
  onUiError,
}: MedsViewProps) {
  const medicationNameInputRef = useRef<HTMLInputElement>(null)
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
  const [isMedicationFormOpen, setIsMedicationFormOpen] = useState(false)
  const [medicationFormError, setMedicationFormError] = useState<string | null>(null)
  const [isMedicationActionInProgress, setIsMedicationActionInProgress] = useState(false)
  const [reminderToggleMedicationId, setReminderToggleMedicationId] = useState<string | null>(null)

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
    setIsMedicationFormOpen(true)
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
  }

  const startCreateMedication = () => {
    resetMedicationForm()
    setIsMedicationFormOpen(true)
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
    setMedicationFormError(null)
  }

  const closeMedicationForm = () => {
    resetMedicationForm()
    setIsMedicationFormOpen(false)
  }

  const toggleMedicationForm = () => {
    if (isMedicationFormOpen) {
      closeMedicationForm()
      return
    }

    startCreateMedication()
  }

  const handleScheduleTypeChange = (nextScheduleType: MedicationScheduleType) => {
    setScheduleTypeInput(nextScheduleType)

    if (!editingMedicationId && nextScheduleType === 'prn') {
      setReminderEnabledInput(false)
    }
  }

  useEffect(() => {
    if (!openMedicationFormRequestId) {
      return
    }

    startCreateMedication()
    onOpenMedicationFormHandled?.()
  }, [openMedicationFormRequestId, onOpenMedicationFormHandled])

  useEffect(() => {
    if (!isMedicationFormOpen) {
      return
    }

    medicationNameInputRef.current?.focus()
  }, [isMedicationFormOpen, openMedicationFormRequestId])

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
      alarmEnabled: existingMedication?.reminderSettings?.alarmEnabled ?? false,
    }

    const medicationInput: UpsertMedicationInput = {
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
        await onUpdateMedication(editingMedicationId, medicationInput)
      } else {
        await onCreateMedication(medicationInput)
      }

      closeMedicationForm()
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

  const summaryRows = patient
    ? buildPatientMedicationSummaryRows(
        medicationsForAdministration,
        doseEvents,
        now,
      )
    : []

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

  const handleDeactivateMedication = async (medicationId: string) => {
    if (isMedicationActionInProgress) {
      return
    }

    try {
      onUiError(null)
      setIsMedicationActionInProgress(true)
      await onDeactivateMedication(medicationId)
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
      await onDeleteMedication(medicationId)

      if (editingMedicationId === medicationId) {
        closeMedicationForm()
      }
    } catch {
      onUiError('Unable to delete medication right now. Please try again.')
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  const handleActivateMedication = async (medicationId: string) => {
    if (isMedicationActionInProgress) {
      return
    }

    try {
      onUiError(null)
      setIsMedicationActionInProgress(true)
      await onActivateMedication(medicationId)
    } catch {
      onUiError('Unable to activate medication right now. Please try again.')
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  const handleToggleMedicationReminder = async (
    medication: Medication,
    enabled: boolean,
  ) => {
    if (isMedicationActionInProgress || reminderToggleMedicationId) {
      return
    }

    try {
      onUiError(null)
      setReminderToggleMedicationId(medication.id)
      await onToggleMedicationReminder(medication, enabled)
    } catch {
      onUiError('Unable to update medication notifications right now. Please try again.')
    } finally {
      setReminderToggleMedicationId(null)
    }
  }

  return (
    <section className="workflow-section" data-testid="meds-view">
      <section className="admin-section no-print">
        <h2>Medication records for {patientDisplayName ?? 'Unknown patient'}</h2>
        <div className="form-actions meds-toolbar">
          <button
            type="button"
            data-testid="start-add-medication-button"
            className="utility-button"
            disabled={isMedicationActionInProgress}
            onClick={toggleMedicationForm}
          >
            {isMedicationFormOpen ? 'Close medication form' : 'Add medication'}
          </button>
        </div>
        {isMedicationFormOpen ? (
          <section className="meds-form-panel" data-testid="medication-form-panel">
            <h3>{editingMedicationId ? 'Edit medication' : 'New medication'}</h3>
        <label>
          Medication name
          <input
            data-testid="medication-name-input"
            type="text"
            ref={medicationNameInputRef}
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
            onChange={(event) => handleScheduleTypeChange(event.target.value as MedicationScheduleType)}
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
          Enable notifications
        </label>
        {reminderEnabledInput ? (
          <label>
            Notification minutes early
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
                : 'Save new medication'}
          </button>
          <button
            type="button"
            className="utility-button"
            disabled={isMedicationActionInProgress}
            onClick={closeMedicationForm}
          >
            Cancel
          </button>
        </div>
          </section>
        ) : null}
        <section className="meds-list-panel" data-testid="medication-list-panel">
          <h3>Medication list</h3>
        <ul className="admin-list">
          {medicationsForAdministration.length === 0 ? (
            <li className="admin-item admin-item-empty">No medications for this patient yet.</li>
          ) : null}
          {medicationsForAdministration.map((medication) => (
            <li key={medication.id} className="admin-item" data-testid={`medication-item-${medication.id}`}>
              <div className="meds-item-main">
                <div>
                  <strong>{medication.name}</strong>
                  <label className="meds-reminder-toggle meds-reminder-toggle-inline">
                    <input
                      type="checkbox"
                      checked={medication.active && Boolean(medication.reminderSettings?.enabled)}
                      disabled={
                        !medication.active ||
                        isMedicationActionInProgress ||
                        reminderToggleMedicationId === medication.id
                      }
                      onChange={(event) => void handleToggleMedicationReminder(medication, event.target.checked)}
                      data-testid={`meds-reminder-toggle-${medication.id}`}
                    />
                    <span className="toggle-switch-track" aria-hidden="true">
                      <span className="toggle-switch-thumb" />
                    </span>
                    <span>
                      {medication.active && Boolean(medication.reminderSettings?.enabled)
                        ? 'Notifications on'
                        : 'Notifications off'}
                    </span>
                  </label>
                </div>
              </div>
              <div className="admin-item-actions">
                <button
                  data-testid={`edit-medication-${medication.id}`}
                  className="utility-button meds-action-button"
                  disabled={isMedicationActionInProgress}
                  onClick={() => startEditMedication(medication)}
                >
                  Edit
                </button>
                {medication.active ? (
                  <button
                    data-testid={`deactivate-medication-${medication.id}`}
                    className="utility-button meds-action-button"
                    disabled={isMedicationActionInProgress}
                    onClick={() => void handleDeactivateMedication(medication.id)}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    data-testid={`activate-medication-${medication.id}`}
                    className="utility-button meds-action-button"
                    disabled={isMedicationActionInProgress}
                    onClick={() => void handleActivateMedication(medication.id)}
                  >
                    Activate
                  </button>
                )}
                <button
                  data-testid={`delete-medication-${medication.id}`}
                  className="utility-button danger-button meds-action-button"
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

      <section className="summary-section print-summary" data-testid="medication-summary-section">
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
        <h3>Patient medication summary</h3>
        <p className="summary-meta">Includes active medications only.</p>
        <p className="summary-meta">Patient: {patient?.displayName ?? ''}</p>
        <p className="summary-meta">Generated: {formatAbsoluteDateTime(now)}</p>
        <ul className="summary-list">
          {summaryRows.map((row) => (
            <li key={row.medicationId} className="summary-item">
              <h4>{row.name}</h4>
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
  )
}
