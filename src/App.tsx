import { useEffect, useState } from 'react'
import type { DoseEvent, MedMinderState } from './domain/types'
import { PatientMedicationListView } from './ui/components/PatientMedicationListView'
import {
  addDoseEvent,
  ensureSeeded,
  getLastSelectedPatientId,
  getPatients,
  loadPatientMedicationView,
  saveLastSelectedPatientId,
} from './storage/repository'
import './App.css'

function createDoseEntry(medicationId: string): DoseEvent {
  return {
    id: crypto.randomUUID(),
    medicationId,
    timestampGiven: new Date().toISOString(),
    corrected: false,
  }
}

function App() {
  const [appState, setAppState] = useState<MedMinderState | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
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
        setSelectedPatientId(selectedPatient.id)
        setAppState({ patients, medications, doseEvents })
      }

      await saveLastSelectedPatientId(selectedPatient.id)
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

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const handleLogDoseNow = async (medicationId: string) => {
    if (!appState || !selectedPatientId) {
      return
    }

    const medication = appState.medications.find((item) => item.id === medicationId)

    if (!medication) {
      return
    }

    const doseEntry = createDoseEntry(medication.id)
    await addDoseEvent(doseEntry)

    const patients = await getPatients()
    const { medications, doseEvents } = await loadPatientMedicationView(selectedPatientId)
    setAppState({ patients, medications, doseEvents })
    setNow(new Date())
  }

  const handlePatientChange = async (patientId: string) => {
    if (!appState) {
      return
    }

    await saveLastSelectedPatientId(patientId)
    setSelectedPatientId(patientId)
    const patients = await getPatients()
    const { medications, doseEvents } = await loadPatientMedicationView(patientId)
    setAppState({ patients, medications, doseEvents })
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Med-Minder</p>
        <h1>{patient.displayName}</h1>
        <p className="subhead">
          Local-first medication timing tracker. No cloud sync. No diagnosis logic.
        </p>
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
          disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}
        >
          {notificationPermission === 'granted'
            ? 'Notifications enabled'
            : notificationPermission === 'unsupported'
              ? 'Notifications unsupported'
              : 'Enable due alerts'}
        </button>
      </header>

      <PatientMedicationListView
        patient={patient}
        medications={medicationsForPatient}
        doseEvents={appState.doseEvents}
        now={now}
        onGiveDose={handleLogDoseNow}
      />
    </main>
  )
}

export default App
