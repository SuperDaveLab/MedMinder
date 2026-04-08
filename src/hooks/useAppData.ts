import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCloudState, replaceCloudState } from '../cloud/syncOrchestrator'
import type { AuthSessionState } from '../domain/auth'
import type { DoseEvent, Medication, MedMinderState } from '../domain/types'
import type { UpsertMedicationInput, UpsertPatientInput } from '../storage/repository'
import { getCurrentTime } from '../ui/clock'
import {
  activateMedication,
  addDoseEvent,
  createDoseCorrectionEvent,
  createMedication,
  createPatient,
  deactivateMedication,
  deleteDoseEventCascade,
  deleteMedicationCascade,
  deletePatientCascade,
  ensureSeeded,
  getLastSelectedPatientId,
  getPatients,
  loadPatientMedicationView,
  saveLastSelectedPatientId,
  setPatientNotificationsEnabled,
  updateMedication,
  updatePatient,
} from '../storage/repository'

function createDoseEntry(medicationId: string): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId,
    timestampGiven: getCurrentTime().toISOString(),
    corrected: false,
  }
}

function trimOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readAndClearPreferredPatientIdFromUrl(): string | null {
  const url = new URL(window.location.href)
  const patientId = url.searchParams.get('patientId')?.trim()

  if (!patientId || patientId.length === 0) {
    return null
  }

  url.searchParams.delete('patientId')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return patientId
}

export interface UseAppDataResult {
  appState: MedMinderState | null
  selectedPatientId: string | null
  now: Date
  uiError: string | null
  isDoseActionInProgress: boolean
  refreshSelectedPatientView: (preferredPatientId?: string | null) => Promise<void>
  handlePatientChange: (patientId: string) => Promise<void>
  handleCreatePatient: (displayName: string, notes?: string) => Promise<void>
  handleUpdatePatient: (patientId: string, input: UpsertPatientInput) => Promise<void>
  handleSetPatientNotificationsEnabled: (patientId: string, enabled: boolean) => Promise<void>
  handleDeletePatient: (patientId: string) => Promise<void>
  handleCreateMedication: (input: UpsertMedicationInput) => Promise<void>
  handleUpdateMedication: (medicationId: string, input: UpsertMedicationInput) => Promise<void>
  handleActivateMedication: (medicationId: string) => Promise<void>
  handleDeactivateMedication: (medicationId: string) => Promise<void>
  handleDeleteMedication: (medicationId: string) => Promise<void>
  handleLogDoseNow: (medicationId: string) => Promise<void>
  handleCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
  handleDeleteDose: (doseEventId: string) => Promise<void>
  setUiError: (message: string | null) => void
}

export function useAppData(authState: AuthSessionState | null): UseAppDataResult {
  const [appState, setAppState] = useState<MedMinderState | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [pendingPreferredPatientId, setPendingPreferredPatientId] = useState<string | null>(
    () => readAndClearPreferredPatientIdFromUrl(),
  )
  const selectedPatientIdRef = useRef<string | null>(selectedPatientId)
  const pendingPreferredPatientIdRef = useRef<string | null>(pendingPreferredPatientId)
  const [now, setNow] = useState(getCurrentTime())
  const [uiError, setUiError] = useState<string | null>(null)
  const [isDoseActionInProgress, setIsDoseActionInProgress] = useState(false)

  const isCloudMode = Boolean(authState)

  useEffect(() => {
    selectedPatientIdRef.current = selectedPatientId
  }, [selectedPatientId])

  useEffect(() => {
    pendingPreferredPatientIdRef.current = pendingPreferredPatientId
  }, [pendingPreferredPatientId])

  const refreshNow = useCallback(() => {
    setNow(getCurrentTime())
  }, [])

  const resolveAndSetState = useCallback(async (
    nextState: MedMinderState,
    preferredPatientId?: string | null,
  ) => {
    if (nextState.patients.length === 0) {
      setSelectedPatientId(null)
      setAppState({ patients: [], medications: [], doseEvents: [] })
      return
    }

    const persistedSelectedPatientId = await getLastSelectedPatientId()
    const resolvedPatientId =
      preferredPatientId
      ?? pendingPreferredPatientIdRef.current
      ?? selectedPatientIdRef.current
      ?? persistedSelectedPatientId
    const selectedPatient =
      nextState.patients.find((patient) => patient.id === resolvedPatientId) ?? nextState.patients[0]

    const matchedPreferredPatientId = preferredPatientId ?? pendingPreferredPatientIdRef.current
    if (matchedPreferredPatientId && selectedPatient.id === matchedPreferredPatientId) {
      setPendingPreferredPatientId(null)
    }

    await saveLastSelectedPatientId(selectedPatient.id)
    setSelectedPatientId(selectedPatient.id)
    setAppState(nextState)
  }, [])

  const loadCloudWorkspaceState = useCallback(async (preferredPatientId?: string | null) => {
    if (!authState) {
      return
    }

    const cloudState = await fetchCloudState(authState)
    await resolveAndSetState(cloudState, preferredPatientId)
  }, [authState, resolveAndSetState])

  const loadLocalWorkspaceState = useCallback(async (preferredPatientId?: string | null) => {
    await ensureSeeded()

    const patients = await getPatients()

    if (patients.length === 0) {
      setSelectedPatientId(null)
      setAppState({ patients: [], medications: [], doseEvents: [] })
      return
    }

    const persistedSelectedPatientId = await getLastSelectedPatientId()
    const resolvedPatientId =
      preferredPatientId
      ?? pendingPreferredPatientIdRef.current
      ?? selectedPatientIdRef.current
      ?? persistedSelectedPatientId
      ?? patients[0].id
    const selectedPatient = patients.find((patient) => patient.id === resolvedPatientId) ?? patients[0]
    const { medications, doseEvents } = await loadPatientMedicationView(selectedPatient.id)

    await saveLastSelectedPatientId(selectedPatient.id)
    setSelectedPatientId(selectedPatient.id)
    setAppState({ patients, medications, doseEvents })
  }, [])

  const refreshSelectedPatientView = useCallback(async (preferredPatientId?: string | null) => {
    if (isCloudMode) {
      await loadCloudWorkspaceState(preferredPatientId)
      return
    }

    await loadLocalWorkspaceState(preferredPatientId)
  }, [isCloudMode, loadCloudWorkspaceState, loadLocalWorkspaceState])

  const commitCloudState = useCallback(async (
    nextState: MedMinderState,
    preferredPatientId?: string | null,
  ) => {
    if (!authState) {
      throw new Error('Cloud session is required for this action.')
    }

    await replaceCloudState(authState, nextState)
    await loadCloudWorkspaceState(preferredPatientId)
  }, [authState, loadCloudWorkspaceState])

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        setUiError(null)

        if (isCloudMode) {
          if (!authState) {
            return
          }

          const cloudState = await fetchCloudState(authState)
          if (!cancelled) {
            await resolveAndSetState(cloudState)
          }
          return
        }

        await loadLocalWorkspaceState()
      } catch {
        if (!cancelled) {
          setUiError('Unable to load data. Please refresh and try again.')
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [authState, isCloudMode, loadLocalWorkspaceState, resolveAndSetState])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshNow()
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [refreshNow])

  useEffect(() => {
    const handleWindowReentry = () => {
      const preferredPatientId = readAndClearPreferredPatientIdFromUrl()

      if (preferredPatientId) {
        setPendingPreferredPatientId(preferredPatientId)
        void refreshSelectedPatientView(preferredPatientId)
        return
      }

      refreshNow()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleWindowReentry()
      }
    }

    window.addEventListener('focus', handleWindowReentry)
    window.addEventListener('pageshow', handleWindowReentry)
    window.addEventListener('online', handleWindowReentry)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowReentry)
      window.removeEventListener('pageshow', handleWindowReentry)
      window.removeEventListener('online', handleWindowReentry)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshNow, refreshSelectedPatientView])

  const handlePatientChange = async (patientId: string) => {
    try {
      setUiError(null)
      await saveLastSelectedPatientId(patientId)
      setSelectedPatientId(patientId)
      await refreshSelectedPatientView(patientId)
    } catch {
      setUiError('Unable to switch patient. Please try again.')
    }
  }

  const handleCreatePatient = async (displayName: string, notes?: string) => {
    const trimmedDisplayName = displayName.trim()

    if (!trimmedDisplayName) {
      throw new Error('Patient displayName is required.')
    }

    setUiError(null)

    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      const createdPatient = {
        id: crypto.randomUUID(),
        displayName: trimmedDisplayName,
        notes: trimOptional(notes),
      }

      await commitCloudState(
        {
          ...appState,
          patients: [...appState.patients, createdPatient],
        },
        createdPatient.id,
      )
      return
    }

    const createdPatient = await createPatient({
      displayName: trimmedDisplayName,
      notes,
    })

    await refreshSelectedPatientView(createdPatient.id)
  }

  const handleUpdatePatient = async (patientId: string, input: UpsertPatientInput) => {
    const trimmedDisplayName = input.displayName.trim()

    if (!trimmedDisplayName) {
      throw new Error('Patient displayName is required.')
    }

    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      const targetPatient = appState.patients.find((patient) => patient.id === patientId)

      if (!targetPatient) {
        throw new Error('Patient not found for update.')
      }

      await commitCloudState(
        {
          ...appState,
          patients: appState.patients.map((patient) =>
            patient.id === patientId
              ? {
                  ...patient,
                  displayName: trimmedDisplayName,
                  notes: trimOptional(input.notes),
                }
              : patient,
          ),
        },
        patientId,
      )
      return
    }

    await updatePatient(patientId, input)
    await refreshSelectedPatientView(patientId)
  }

  const handleSetPatientNotificationsEnabled = async (patientId: string, enabled: boolean) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      await commitCloudState(
        {
          ...appState,
          patients: appState.patients.map((patient) =>
            patient.id === patientId ? { ...patient, notificationsEnabled: enabled } : patient,
          ),
        },
        patientId,
      )
      return
    }

    await setPatientNotificationsEnabled(patientId, enabled)
    await refreshSelectedPatientView(patientId)
  }

  const handleDeletePatient = async (patientId: string) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      const medicationIds = new Set(
        appState.medications
          .filter((medication) => medication.patientId === patientId)
          .map((medication) => medication.id),
      )

      const nextPatients = appState.patients.filter((patient) => patient.id !== patientId)
      const nextMedications = appState.medications.filter((medication) => medication.patientId !== patientId)
      const nextDoseEvents = appState.doseEvents.filter((doseEvent) => !medicationIds.has(doseEvent.medicationId))

      await commitCloudState(
        {
          patients: nextPatients,
          medications: nextMedications,
          doseEvents: nextDoseEvents,
        },
        selectedPatientId === patientId ? null : selectedPatientId,
      )
      return
    }

    await deletePatientCascade(patientId)
    await refreshSelectedPatientView(selectedPatientId === patientId ? null : selectedPatientId)
  }

  const handleCreateMedication = async (input: UpsertMedicationInput) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      const medication: Medication = {
        id: crypto.randomUUID(),
        patientId: input.patientId,
        name: input.name.trim(),
        strengthText: trimOptional(input.strengthText),
        instructions: trimOptional(input.instructions),
        defaultDoseText: input.defaultDoseText.trim(),
        active: input.active,
        schedule: input.schedule,
        reminderSettings: input.reminderSettings,
      }

      await commitCloudState(
        {
          ...appState,
          medications: [...appState.medications, medication],
        },
        input.patientId,
      )
      return
    }

    await createMedication(input)
    await refreshSelectedPatientView(input.patientId)
  }

  const handleUpdateMedication = async (medicationId: string, input: UpsertMedicationInput) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    if (isCloudMode) {
      const existing = appState.medications.find((medication) => medication.id === medicationId)

      if (!existing) {
        throw new Error('Medication not found for update.')
      }

      await commitCloudState(
        {
          ...appState,
          medications: appState.medications.map((medication) =>
            medication.id === medicationId
              ? {
                  ...medication,
                  patientId: input.patientId,
                  name: input.name.trim(),
                  strengthText: trimOptional(input.strengthText),
                  instructions: trimOptional(input.instructions),
                  defaultDoseText: input.defaultDoseText.trim(),
                  active: input.active,
                  schedule: input.schedule,
                  reminderSettings: input.reminderSettings,
                }
              : medication,
          ),
        },
        input.patientId,
      )
      return
    }

    await updateMedication(medicationId, input)
    await refreshSelectedPatientView(input.patientId)
  }

  const handleDeactivateMedication = async (medicationId: string) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    const medication = appState.medications.find((item) => item.id === medicationId)

    if (!medication) {
      throw new Error('Medication not found for deactivation.')
    }

    if (isCloudMode) {
      await commitCloudState(
        {
          ...appState,
          medications: appState.medications.map((item) =>
            item.id === medicationId ? { ...item, active: false } : item,
          ),
        },
        medication.patientId,
      )
      return
    }

    await deactivateMedication(medicationId)
    await refreshSelectedPatientView(medication.patientId)
  }

  const handleActivateMedication = async (medicationId: string) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    const medication = appState.medications.find((item) => item.id === medicationId)

    if (!medication) {
      throw new Error('Medication not found for activation.')
    }

    if (isCloudMode) {
      await commitCloudState(
        {
          ...appState,
          medications: appState.medications.map((item) =>
            item.id === medicationId ? { ...item, active: true } : item,
          ),
        },
        medication.patientId,
      )
      return
    }

    await activateMedication(medicationId)
    await refreshSelectedPatientView(medication.patientId)
  }

  const handleDeleteMedication = async (medicationId: string) => {
    if (!appState) {
      throw new Error('App state is not loaded yet.')
    }

    const medication = appState.medications.find((item) => item.id === medicationId)

    if (!medication) {
      throw new Error('Medication not found for deletion.')
    }

    if (isCloudMode) {
      await commitCloudState(
        {
          ...appState,
          medications: appState.medications.filter((item) => item.id !== medicationId),
          doseEvents: appState.doseEvents.filter((doseEvent) => doseEvent.medicationId !== medicationId),
        },
        medication.patientId,
      )
      return
    }

    await deleteMedicationCascade(medicationId)
    await refreshSelectedPatientView(medication.patientId)
  }

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

      if (isCloudMode) {
        await commitCloudState(
          {
            ...appState,
            doseEvents: [...appState.doseEvents, doseEntry],
          },
          selectedPatientId,
        )
      } else {
        await addDoseEvent(doseEntry)
        await refreshSelectedPatientView(selectedPatientId)
      }

      refreshNow()
    } catch {
      setUiError('Unable to log dose right now. Please try again.')
    } finally {
      setIsDoseActionInProgress(false)
    }
  }

  const handleCorrectDose = async (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => {
    if (!selectedPatientId || isDoseActionInProgress || !appState) {
      return
    }

    try {
      setUiError(null)
      setIsDoseActionInProgress(true)

      if (isCloudMode) {
        const originalDoseEvent = appState.doseEvents.find(
          (doseEvent) => doseEvent.id === originalDoseEventId,
        )

        if (!originalDoseEvent) {
          throw new Error('Original dose event not found for correction.')
        }

        const correctionDoseEvent: DoseEvent = {
          id: crypto.randomUUID(),
          medicationId: originalDoseEvent.medicationId,
          timestampGiven: replacementTimestampGiven,
          doseText: originalDoseEvent.doseText,
          givenBy: originalDoseEvent.givenBy,
          notes: trimOptional(notes),
          corrected: true,
          supersedesDoseEventId: originalDoseEvent.id,
        }

        await commitCloudState(
          {
            ...appState,
            doseEvents: [...appState.doseEvents, correctionDoseEvent],
          },
          selectedPatientId,
        )
      } else {
        await createDoseCorrectionEvent({
          originalDoseEventId,
          replacementTimestampGiven,
          notes,
        })

        await refreshSelectedPatientView(selectedPatientId)
      }

      refreshNow()
    } catch {
      setUiError('Unable to save correction right now. Please try again.')
      throw new Error('Correction save failed')
    } finally {
      setIsDoseActionInProgress(false)
    }
  }

  const handleDeleteDose = async (doseEventId: string) => {
    if (!selectedPatientId || isDoseActionInProgress || !appState) {
      return
    }

    try {
      setUiError(null)
      setIsDoseActionInProgress(true)

      if (isCloudMode) {
        const doseEventIdsToDelete = new Set<string>()
        const queue: string[] = [doseEventId]

        while (queue.length > 0) {
          const currentDoseEventId = queue.shift()

          if (!currentDoseEventId || doseEventIdsToDelete.has(currentDoseEventId)) {
            continue
          }

          doseEventIdsToDelete.add(currentDoseEventId)

          for (const doseEvent of appState.doseEvents) {
            if (doseEvent.corrected && doseEvent.supersedesDoseEventId === currentDoseEventId) {
              queue.push(doseEvent.id)
            }
          }
        }

        await commitCloudState(
          {
            ...appState,
            doseEvents: appState.doseEvents.filter(
              (doseEvent) => !doseEventIdsToDelete.has(doseEvent.id),
            ),
          },
          selectedPatientId,
        )
      } else {
        await deleteDoseEventCascade(doseEventId)
        await refreshSelectedPatientView(selectedPatientId)
      }

      refreshNow()
    } catch {
      setUiError('Unable to delete dose right now. Please try again.')
      throw new Error('Dose delete failed')
    } finally {
      setIsDoseActionInProgress(false)
    }
  }

  return {
    appState,
    selectedPatientId,
    now,
    uiError,
    isDoseActionInProgress,
    refreshSelectedPatientView,
    handlePatientChange,
    handleCreatePatient,
    handleUpdatePatient,
    handleSetPatientNotificationsEnabled,
    handleDeletePatient,
    handleCreateMedication,
    handleUpdateMedication,
    handleActivateMedication,
    handleDeactivateMedication,
    handleDeleteMedication,
    handleLogDoseNow,
    handleCorrectDose,
    handleDeleteDose,
    setUiError,
  }
}
