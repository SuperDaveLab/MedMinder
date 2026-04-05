import { useEffect, useState } from 'react'
import type { DoseEvent, MedMinderState } from '../domain/types'
import {
  addDoseEvent,
  createDoseCorrectionEvent,
  createPatient,
  ensureSeeded,
  getLastSelectedPatientId,
  getPatients,
  loadPatientMedicationView,
  saveLastSelectedPatientId,
} from '../storage/repository'

function createDoseEntry(medicationId: string): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId,
    timestampGiven: new Date().toISOString(),
    corrected: false,
  }
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
  handleLogDoseNow: (medicationId: string) => Promise<void>
  handleCorrectDose: (
    originalDoseEventId: string,
    replacementTimestampGiven: string,
    notes?: string,
  ) => Promise<void>
  setUiError: (message: string | null) => void
}

export function useAppData(): UseAppDataResult {
  const [appState, setAppState] = useState<MedMinderState | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [uiError, setUiError] = useState<string | null>(null)
  const [isDoseActionInProgress, setIsDoseActionInProgress] = useState(false)

  const refreshSelectedPatientView = async (preferredPatientId?: string | null) => {
    const patients = await getPatients()

    if (patients.length === 0) {
      setSelectedPatientId(null)
      setAppState({ patients: [], medications: [], doseEvents: [] })
      return
    }

    const resolvedPatientId = preferredPatientId ?? selectedPatientId ?? patients[0].id
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
        const selectedPatient =
          patients.find((patient) => patient.id === persistedSelectedPatientId) ?? patients[0]

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

  const handleCreatePatient = async (displayName: string, notes?: string) => {
    setUiError(null)

    const createdPatient = await createPatient({
      displayName,
      notes,
    })

    await refreshSelectedPatientView(createdPatient.id)
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

  return {
    appState,
    selectedPatientId,
    now,
    uiError,
    isDoseActionInProgress,
    refreshSelectedPatientView,
    handlePatientChange,
    handleCreatePatient,
    handleLogDoseNow,
    handleCorrectDose,
    setUiError,
  }
}
