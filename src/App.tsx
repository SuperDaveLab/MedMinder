import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type {
  DoseEvent,
  LocalDateString,
  Medication,
  MedicationSchedule,
  MedMinderState,
  Patient,
  TimeOfDayHHmm,
} from './domain/types'
import { PatientMedicationListView } from './ui/components/PatientMedicationListView'
import {
  addDoseEvent,
  createMedication,
  createPatient,
  createDoseCorrectionEvent,
  deactivateMedication,
  deleteMedicationCascade,
  deletePatientCascade,
  ensureSeeded,
  getLastSelectedPatientId,
  getPatients,
  getReminderNotificationLog,
  importFullBackup,
  loadPatientMedicationView,
  exportFullBackup,
  saveReminderNotificationLog,
  saveLastSelectedPatientId,
  updateMedication,
  updatePatient,
} from './storage/repository'
import { validateBackup } from './storage/backup'
import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
  getReminderPermissionState,
  getReminderStatusLabel,
} from './reminders/notifications'
import {
  buildPatientMedicationSummaryRows,
  buildPatientSummaryText,
} from './export/patientSummary'
import { formatAbsoluteDateTime, formatRelativeTime } from './ui/time'
import './App.css'

type AppView = 'care' | 'history' | 'admin' | 'summary'

interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>
  }
}

function getInitialViewFromUrl(): AppView {
  const url = new URL(window.location.href)
  const view = url.searchParams.get('view')

  if (view === 'care' || view === 'history' || view === 'admin' || view === 'summary') {
    return view
  }

  return 'care'
}

function updateUrlForView(view: AppView): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', view)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(display-mode: standalone)').matches
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  downloadLink.click()
  URL.revokeObjectURL(objectUrl)
}

function createDoseEntry(medicationId: string): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId,
    timestampGiven: new Date().toISOString(),
    corrected: false,
  }
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

function App() {
  const [appState, setAppState] = useState<MedMinderState | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [notificationPermission, setNotificationPermission] = useState(getReminderPermissionState())
  const [activeView, setActiveView] = useState<AppView>(getInitialViewFromUrl())
  const [uiError, setUiError] = useState<string | null>(null)
  const [isPatientActionInProgress, setIsPatientActionInProgress] = useState(false)
  const [isMedicationActionInProgress, setIsMedicationActionInProgress] = useState(false)
  const [isDoseActionInProgress, setIsDoseActionInProgress] = useState(false)
  const [isBackupActionInProgress, setIsBackupActionInProgress] = useState(false)
  const [backupStatusMessage, setBackupStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const [installPromptEvent, setInstallPromptEvent] = useState<DeferredInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean }
    return isStandaloneDisplayMode() || nav.standalone === true
  })
  const [installHint, setInstallHint] = useState<string | null>(null)
  const [isWakeLockActive, setIsWakeLockActive] = useState(false)
  const [wakeLockMessage, setWakeLockMessage] = useState<string | null>(null)

  const reminderRunInFlightRef = useRef(false)
  const sentReminderKeysRef = useRef<Set<string>>(new Set())
  const backupFileInputRef = useRef<HTMLInputElement>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const appVersion = __APP_VERSION__
  const wakeLockSupported = Boolean((navigator as Navigator & NavigatorWithWakeLock).wakeLock)
  const shareSupported = typeof navigator.share === 'function'

  const [patientDisplayNameInput, setPatientDisplayNameInput] = useState('')
  const [patientNotesInput, setPatientNotesInput] = useState('')
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null)
  const [patientFormError, setPatientFormError] = useState<string | null>(null)

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
  const [reminderEnabledInput, setReminderEnabledInput] = useState(false)
  const [reminderMinutesInput, setReminderMinutesInput] = useState<'10' | '15'>('10')
  const [medicationFormError, setMedicationFormError] = useState<string | null>(null)

  const resetPatientForm = () => {
    setEditingPatientId(null)
    setPatientDisplayNameInput('')
    setPatientNotesInput('')
    setPatientFormError(null)
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
    setReminderEnabledInput(false)
    setReminderMinutesInput('10')
    setMedicationFormError(null)
  }

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

  const refreshSelectedPatientView = async (preferredPatientId?: string | null) => {
    const patients = await getPatients()

    if (patients.length === 0) {
      setSelectedPatientId(null)
      setAppState({ patients: [], medications: [], doseEvents: [] })
      return
    }

    const resolvedPatientId =
      preferredPatientId ??
      selectedPatientId ??
      patients[0].id

    const selectedPatient = patients.find((patient) => patient.id === resolvedPatientId) ?? patients[0]
    const { medications, doseEvents } = await loadPatientMedicationView(selectedPatient.id)

    await saveLastSelectedPatientId(selectedPatient.id)
    setSelectedPatientId(selectedPatient.id)
    setAppState({ patients, medications, doseEvents })
  }

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        setUiError(null)
        await ensureSeeded()

        const patients = await getPatients()
        const persistedSelectedPatientId = await getLastSelectedPatientId()
        const preferredPatientId = selectedPatientId ?? persistedSelectedPatientId
        const selectedPatient =
          patients.find((patient) => patient.id === preferredPatientId) ?? patients[0]

        if (!selectedPatient) {
          if (!cancelled) {
            setAppState({ patients: [], medications: [], doseEvents: [] })
          }
          return
        }

        const { medications, doseEvents } = await loadPatientMedicationView(selectedPatient.id)

        if (!cancelled) {
          await saveLastSelectedPatientId(selectedPatient.id)
          setSelectedPatientId(selectedPatient.id)
          setAppState({ patients, medications, doseEvents })
        }
      } catch {
        if (!cancelled) {
          setUiError('Unable to load local data. Please refresh and try again.')
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as DeferredInstallPromptEvent)
      setInstallHint('Install available on this device.')
    }

    const onAppInstalled = () => {
      setIsInstalled(true)
      setInstallPromptEvent(null)
      setInstallHint('App installed.')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleInstallApp = async () => {
    if (isInstalled) {
      setInstallHint('Already installed.')
      return
    }

    if (!installPromptEvent) {
      setInstallHint('Install prompt unavailable. Use your browser menu to Add to Home Screen.')
      return
    }

    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice

    if (choice.outcome === 'accepted') {
      setInstallHint('Install accepted.')
      setInstallPromptEvent(null)
      setIsInstalled(true)
    } else {
      setInstallHint('Install dismissed.')
    }
  }

  const handleToggleWakeLock = async () => {
    const nav = navigator as Navigator & NavigatorWithWakeLock

    if (!nav.wakeLock) {
      setWakeLockMessage('Wake lock is not supported on this browser/device.')
      return
    }

    if (isWakeLockActive && wakeLockRef.current) {
      await wakeLockRef.current.release()
      wakeLockRef.current = null
      setIsWakeLockActive(false)
      setWakeLockMessage('Screen wake lock off.')
      return
    }

    try {
      const sentinel = await nav.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null
        setIsWakeLockActive(false)
      })
      setIsWakeLockActive(true)
      setWakeLockMessage('Screen wake lock on.')
    } catch {
      setWakeLockMessage('Unable to enable wake lock right now.')
    }
  }

  const setView = (view: AppView) => {
    setActiveView(view)
    updateUrlForView(view)
  }

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined' || notificationPermission !== 'default') {
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const checkAndSendReminders = async (
    currentState: MedMinderState,
    currentNow: Date,
  ) => {
    if (notificationPermission !== 'granted' || typeof Notification === 'undefined') {
      return
    }

    if (reminderRunInFlightRef.current) {
      return
    }

    reminderRunInFlightRef.current = true

    try {
      const candidates = buildReminderNotificationCandidates(
        currentState.medications,
        currentState.doseEvents,
        currentNow,
      )

      if (candidates.length === 0) {
        return
      }

      const reminderLog = await getReminderNotificationLog()
      const unsentCandidates = filterUnsentReminderCandidates(candidates, reminderLog)
        .filter((candidate) => !sentReminderKeysRef.current.has(candidate.dedupeKey))

      if (unsentCandidates.length === 0) {
        return
      }

      const updatedReminderLog = { ...reminderLog }

      for (const candidate of unsentCandidates) {
        new Notification(candidate.title, {
          body: candidate.body,
          tag: candidate.dedupeKey,
        })
        updatedReminderLog[candidate.dedupeKey] = currentNow.toISOString()
        sentReminderKeysRef.current.add(candidate.dedupeKey)
      }

      await saveReminderNotificationLog(updatedReminderLog)
    } finally {
      reminderRunInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!appState) {
      return
    }

    void checkAndSendReminders(appState, now)
  }, [appState, now, notificationPermission])

  const handleLogDoseNow = async (medicationId: string) => {
    if (!appState || !selectedPatientId || isDoseActionInProgress) {
      return
    }

    try {
      setUiError(null)
      setIsDoseActionInProgress(true)

      const medication = appState.medications.find((item) => item.id === medicationId)

      if (!medication) {
        return
      }

      const doseEntry = createDoseEntry(medication.id)
      await addDoseEvent(doseEntry)

      await refreshSelectedPatientView(selectedPatientId)
      setNow(new Date())
    } catch {
      setUiError('Unable to log dose right now. Please try again.')
    } finally {
      setIsDoseActionInProgress(false)
    }
  }

  const handlePatientChange = async (patientId: string) => {
    try {
      setUiError(null)
      await refreshSelectedPatientView(patientId)
    } catch {
      setUiError('Unable to switch patient. Please try again.')
    }
  }

  const handleCorrectDose = async (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => {
    if (!selectedPatientId || isDoseActionInProgress) {
      return
    }

    try {
      setUiError(null)
      setIsDoseActionInProgress(true)

      await createDoseCorrectionEvent({
        originalDoseEventId,
        replacementTimestampGiven,
        notes,
      })

      await refreshSelectedPatientView(selectedPatientId)
      setNow(new Date())
    } catch {
      setUiError('Unable to save correction right now. Please try again.')
      throw new Error('Correction save failed')
    } finally {
      setIsDoseActionInProgress(false)
    }
  }

  const startEditPatient = (patient: Patient) => {
    setEditingPatientId(patient.id)
    setPatientDisplayNameInput(patient.displayName)
    setPatientNotesInput(patient.notes ?? '')
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
      setUiError(null)
      setPatientFormError(null)
      setIsPatientActionInProgress(true)

      if (editingPatientId) {
        await updatePatient(editingPatientId, {
          displayName,
          notes: patientNotesInput,
        })
        await refreshSelectedPatientView(editingPatientId)
      } else {
        const createdPatient = await createPatient({
          displayName,
          notes: patientNotesInput,
        })
        await refreshSelectedPatientView(createdPatient.id)
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
      setUiError(null)
      setIsPatientActionInProgress(true)
      await deletePatientCascade(patientId)
      await refreshSelectedPatientView(patientId === selectedPatientId ? null : selectedPatientId)

      if (editingPatientId === patientId) {
        resetPatientForm()
      }
    } catch {
      setUiError('Unable to delete patient right now. Please try again.')
    } finally {
      setIsPatientActionInProgress(false)
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
    setReminderMinutesInput(String(medication.reminderSettings?.earlyReminderMinutes ?? 10) as '10' | '15')
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
      ? appState?.medications.find((medication) => medication.id === editingMedicationId)
      : null

    const reminderSettings = reminderEnabledInput
      ? {
          enabled: true,
          earlyReminderMinutes: Number.parseInt(reminderMinutesInput, 10) as 10 | 15,
        }
      : { enabled: false as const }

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
      setUiError(null)
      setMedicationFormError(null)
      setIsMedicationActionInProgress(true)

      if (editingMedicationId) {
        await updateMedication(editingMedicationId, medicationInput)
      } else {
        await createMedication(medicationInput)
      }

      await refreshSelectedPatientView(selectedPatientId)
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
      setUiError(null)
      setIsMedicationActionInProgress(true)
      await deactivateMedication(medicationId)
      await refreshSelectedPatientView(selectedPatientId)
    } catch {
      setUiError('Unable to deactivate medication right now. Please try again.')
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
      setUiError(null)
      setIsMedicationActionInProgress(true)
      await deleteMedicationCascade(medicationId)
      await refreshSelectedPatientView(selectedPatientId)

      if (editingMedicationId === medicationId) {
        resetMedicationForm()
      }
    } catch {
      setUiError('Unable to delete medication right now. Please try again.')
    } finally {
      setIsMedicationActionInProgress(false)
    }
  }

  if (!appState) {
    return (
      <main className="app-shell">
        <section className="app-header">
          <p className="subhead">Loading local data...</p>
        </section>
      </main>
    )
  }

  if (appState.patients.length === 0) {
    return (
      <main className="app-shell">
        <section className="app-header">
          <p className="subhead">No patients found in local database.</p>
          <section className="admin-section">
            <h2>Patient administration</h2>
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
                {isPatientActionInProgress ? 'Saving...' : 'Add patient'}
              </button>
            </div>
          </section>
        </section>
      </main>
    )
  }

  const patient =
    appState.patients.find((item) => item.id === selectedPatientId) ??
    appState.patients[0]
  const medicationsForPatient = appState.medications.filter(
    (medication) => medication.patientId === patient.id && medication.active,
  )
  const medicationById = new Map(
    appState.medications.map((medication) => [medication.id, medication.name]),
  )
  const correctionBySupersededId = new Map(
    appState.doseEvents
      .filter((doseEvent) => doseEvent.corrected)
      .map((doseEvent) => [doseEvent.supersedesDoseEventId, doseEvent]),
  )
  const recentHistory = [...appState.doseEvents]
    .sort((a, b) => b.timestampGiven.localeCompare(a.timestampGiven))
    .slice(0, 12)

  const summaryRows = buildPatientMedicationSummaryRows(
    medicationsForPatient,
    appState.doseEvents,
    now,
  )
  const medicationsForAdministration = appState.medications.filter(
    (medication) => medication.patientId === patient.id,
  )

  const handlePrintSummary = () => {
    window.print()
  }

  const handleExportSummary = () => {
    const summaryText = buildPatientSummaryText(patient, now, summaryRows)
    const fileName = `${patient.displayName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-medication-summary-${now.toISOString().slice(0, 10)}.txt`
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, fileName)
  }

  const handleShareSummary = async () => {
    const summaryText = buildPatientSummaryText(patient, now, summaryRows)
    const fileName = `${patient.displayName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-medication-summary-${now.toISOString().slice(0, 10)}.txt`

    if (!shareSupported) {
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

    if (!shareSupported) {
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
    // Reset the input value so the same file can be re-selected if needed
    event.target.value = ''
    if (!file) return
    if (isBackupActionInProgress) return
    setBackupStatusMessage(null)

    let text: string
    try {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target?.result as string)
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
      await refreshSelectedPatientView(null)
      setBackupStatusMessage({ kind: 'success', text: 'Backup restored successfully.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setBackupStatusMessage({ kind: 'error', text: `Import failed: ${message}` })
    } finally {
      setIsBackupActionInProgress(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Med-Minder</p>
        <h1>{patient.displayName}</h1>
        <p className="subhead">
          Local-first medication timing tracker. No cloud sync. No diagnosis logic.
        </p>
        <p className="app-meta">Version {appVersion} | Local data only</p>
        <label className="patient-picker">
          <span>Selected patient</span>
          <select
            value={patient.id}
            onChange={(event) => void handlePatientChange(event.target.value)}
          >
            {appState.patients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          className="notify-button"
          onClick={requestNotificationPermission}
          disabled={notificationPermission !== 'default' || isDoseActionInProgress}
        >
          {notificationPermission === 'granted'
            ? 'Notifications enabled'
            : notificationPermission === 'unsupported'
              ? 'Notifications unsupported'
              : notificationPermission === 'denied'
                ? 'Notifications denied'
              : 'Enable due alerts'}
        </button>
        <p className="reminder-state">{getReminderStatusLabel(notificationPermission)}</p>
        <div className="app-actions no-print">
          <button
            className="utility-button"
            onClick={() => void handleInstallApp()}
            disabled={!installPromptEvent || isInstalled}
            data-testid="install-app-button"
          >
            {isInstalled ? 'Installed' : installPromptEvent ? 'Install app' : 'Install unavailable'}
          </button>
          <button
            className="utility-button"
            onClick={() => void handleToggleWakeLock()}
            disabled={!wakeLockSupported}
            data-testid="wake-lock-button"
          >
            {isWakeLockActive ? 'Keep screen awake: on' : 'Keep screen awake'}
          </button>
        </div>
        <p className="pwa-status" data-testid="install-status">
          {isInstalled
            ? 'Already installed.'
            : installPromptEvent
              ? 'Install available.'
              : 'Install not supported here. Use browser menu to Add to Home Screen.'}
        </p>
        {installHint ? <p className="pwa-status">{installHint}</p> : null}
        {wakeLockMessage ? <p className="pwa-status">{wakeLockMessage}</p> : null}
        {uiError ? <p className="form-error">{uiError}</p> : null}
        <nav className="view-tabs no-print" aria-label="Primary views">
          <button
            className={`view-tab ${activeView === 'care' ? 'is-active' : ''}`}
            data-testid="tab-care"
            onClick={() => setView('care')}
          >
            Care
          </button>
          <button
            className={`view-tab ${activeView === 'history' ? 'is-active' : ''}`}
            data-testid="tab-history"
            onClick={() => setView('history')}
          >
            History
          </button>
          <button
            className={`view-tab ${activeView === 'admin' ? 'is-active' : ''}`}
            data-testid="tab-admin"
            onClick={() => setView('admin')}
          >
            Admin
          </button>
          <button
            className={`view-tab ${activeView === 'summary' ? 'is-active' : ''}`}
            data-testid="tab-summary"
            onClick={() => setView('summary')}
          >
            Summary
          </button>
        </nav>
      </header>

      {activeView === 'care' ? (
        <section className="workflow-section" data-testid="care-view">
          <section className="care-layout">
            <PatientMedicationListView
              patient={patient}
              medications={medicationsForPatient}
              doseEvents={appState.doseEvents}
              now={now}
              onGiveDose={handleLogDoseNow}
              onCorrectDose={handleCorrectDose}
              actionsDisabled={isDoseActionInProgress}
            />
            <section className="history-section care-history-section" data-testid="care-recent-history">
              <h2>Recent dose history</h2>
              <ul className="history-list compact-history-list">
                {recentHistory.length === 0 ? (
                  <li className="history-item history-item-empty">No doses logged yet.</li>
                ) : (
                  recentHistory.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="history-item compact-history-item">
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
                        {formatAbsoluteDateTime(new Date(entry.timestampGiven))} ({formatRelativeTime(new Date(entry.timestampGiven), now)})
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </section>
        </section>
      ) : null}

      {activeView === 'history' ? (
        <section className="workflow-section" data-testid="history-view">
          <section className="history-section">
            <h2>All dose history</h2>
            <ul className="history-list">
              {recentHistory.length === 0 ? (
                <li className="history-item history-item-empty">No doses logged yet.</li>
              ) : (
                recentHistory.map((entry) => (
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
                      {formatAbsoluteDateTime(new Date(entry.timestampGiven))} ({formatRelativeTime(new Date(entry.timestampGiven), now)})
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </section>
      ) : null}

      {activeView === 'admin' ? (
        <section className="workflow-section" data-testid="admin-view">
          <section className="admin-section no-print">
            <h2>Patient records</h2>
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
                    : 'Add patient'}
              </button>
              {editingPatientId ? (
                <button className="utility-button" disabled={isPatientActionInProgress} onClick={resetPatientForm}>Cancel</button>
              ) : null}
            </div>
            <ul className="admin-list">
              {appState.patients.map((listedPatient) => (
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
                  onChange={(event) => setReminderMinutesInput(event.target.value as '10' | '15')}
                >
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
              onChange={(e) => void handleImportBackup(e)}
              data-testid="backup-file-input"
            />
          </section>
        </section>
      ) : null}

      {activeView === 'summary' ? (
        <section className="workflow-section" data-testid="summary-view">
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
            <p className="summary-meta">Patient: {patient.displayName}</p>
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
      ) : null}
    </main>
  )
}

export default App
