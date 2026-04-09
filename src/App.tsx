import { useEffect, useState, type FormEvent } from 'react'
import { useAppData } from './hooks/useAppData'
import { useAuth } from './hooks/useAuth'
import { useAppShell } from './hooks/useAppShell'
import { CareView } from './features/care/CareView'
import { HistoryView } from './features/history/HistoryView'
import { MedsView } from './features/meds/MedsView'
import { PatientsView } from './features/patients/PatientsView'
import { MoreView } from './features/more/MoreView'
import type { Medication } from './domain/types'
import type { UpsertMedicationInput } from './storage/repository'
import { formatRelativeTime } from './ui/time'
import './App.css'

function App() {
  const {
    authState,
    isAuthLoading,
    isAuthActionInProgress,
    authSessions,
    isAuthSessionsLoading,
    authError,
    createAccount,
    signIn,
    signOut,
    changePassword,
    requestPasswordReset,
    resetPassword,
    updateAccountSettings,
    refreshAuthSessions,
    revokeOtherAuthSessions,
    clearAuthError,
  } = useAuth()

  const {
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
  } = useAppData(authState)

  const [isAddPatientFormOpen, setIsAddPatientFormOpen] = useState(false)
  const [newPatientDisplayName, setNewPatientDisplayName] = useState('')
  const [newPatientError, setNewPatientError] = useState<string | null>(null)
  const [isAddPatientInProgress, setIsAddPatientInProgress] = useState(false)
  const [openMedicationFormRequestId, setOpenMedicationFormRequestId] = useState(0)

  const {
    activeView,
    setView,
    notificationPermission,
    requestNotificationPermission,
    installPromptAvailable,
    isInstalled,
    handleInstallApp,
    wakeLockSupported,
    isWakeLockActive,
    handleToggleWakeLock,
    activeAlarm,
    acknowledgeActiveAlarm,
    snoozeActiveAlarm,
    triggerAlarmPreview,
  } = useAppShell({ appState, now, authState })

  const resetAddPatientForm = () => {
    setIsAddPatientFormOpen(false)
    setNewPatientDisplayName('')
    setNewPatientError(null)
  }

  const handleOpenAddPatientForm = () => {
    setUiError(null)
    setNewPatientError(null)
    setIsAddPatientFormOpen((current) => !current)
  }

  const handleAddPatientSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isAddPatientInProgress) {
      return
    }

    const displayName = newPatientDisplayName.trim()

    if (!displayName) {
      setNewPatientError('Patient display name is required.')
      return
    }

    try {
      setUiError(null)
      setNewPatientError(null)
      setIsAddPatientInProgress(true)
      await handleCreatePatient(displayName)
      resetAddPatientForm()
    } catch (error) {
      setNewPatientError(
        error instanceof Error ? error.message : 'Unable to add patient right now.',
      )
    } finally {
      setIsAddPatientInProgress(false)
    }
  }

  const handleTogglePatientNotifications = async (patientId: string, enabled: boolean) => {
    await handleSetPatientNotificationsEnabled(patientId, enabled)
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)

    if (!searchParams.get('resetToken')) {
      return
    }

    setView('more')
  }, [setView])

  useEffect(() => {
    if (activeView !== 'care') {
      return
    }

    let cancelled = false
    let inFlight = false

    const refreshCareView = async () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') {
        return
      }

      inFlight = true
      try {
        await refreshSelectedPatientView()
      } catch {
        // Keep polling; transient errors should not break the care screen.
      } finally {
        inFlight = false
      }
    }

    void refreshCareView()
    const timer = window.setInterval(() => {
      void refreshCareView()
    }, 5_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeView, refreshSelectedPatientView])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return
    }

    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      const payload = event.data as { type?: string; patientId?: string } | null

      if (payload?.type !== 'medminder-select-patient' || !payload.patientId) {
        return
      }

      setView('care')
      void handlePatientChange(payload.patientId)
    }

    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)

    return () => {
      navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage)
    }
  }, [handlePatientChange, setView])

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
          <PatientsView
            noPatientsMode
            patients={appState.patients}
            onDataChanged={refreshSelectedPatientView}
            onUiError={setUiError}
            onCreatePatient={handleCreatePatient}
            onUpdatePatient={handleUpdatePatient}
            onTogglePatientNotifications={handleTogglePatientNotifications}
            onDeletePatient={handleDeletePatient}
          />
        </section>
      </main>
    )
  }

  const patient = appState.patients.find((item) => item.id === selectedPatientId) ?? appState.patients[0]
  const medicationsForPatient = appState.medications.filter(
    (medication) => medication.patientId === patient.id && medication.active,
  )
  const medicationsForAdministration = appState.medications.filter(
    (medication) => medication.patientId === patient.id,
  )
  const isPatientWorkspace = activeView === 'care' || activeView === 'history' || activeView === 'meds'

  const buildMedicationUpsertInput = (
    medication: Medication,
    reminderEnabled: boolean,
  ): UpsertMedicationInput => ({
    patientId: medication.patientId,
    name: medication.name,
    strengthText: medication.strengthText,
    instructions: medication.instructions,
    defaultDoseText: medication.defaultDoseText,
    active: medication.active,
    schedule: medication.schedule,
    inventoryEnabled: medication.inventoryEnabled === true,
    initialQuantity: medication.initialQuantity,
    doseAmount: medication.doseAmount,
    doseUnit: medication.doseUnit,
    lowSupplyThreshold: medication.lowSupplyThreshold,
    reminderSettings: {
      ...medication.reminderSettings,
      enabled: reminderEnabled,
      earlyReminderMinutes: medication.reminderSettings?.earlyReminderMinutes ?? 0,
    },
  })

  const handleToggleMedicationReminder = async (
    medication: Medication,
    reminderEnabled: boolean,
  ) => {
    await handleUpdateMedication(
      medication.id,
      buildMedicationUpsertInput(medication, reminderEnabled),
    )
  }

  return (
    <div className="layout-root">
      <header className="top-app-bar no-print">
        <div className="top-app-bar-main">
          {isPatientWorkspace ? (
            <>
              <div className="patient-switcher-row">
                <div className="patient-context-block is-primary">
                  <p className="patient-context-label">Selected patient</p>
                  <label className="patient-selector-compact">
                    <span className="patient-avatar" aria-hidden="true">👤</span>
                    <select
                      aria-label="Selected patient"
                      value={patient.id}
                      onChange={(event) => void handlePatientChange(event.target.value)}
                    >
                      {appState.patients.map((item) => (
                        <option key={item.id} value={item.id}>{item.displayName}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className="utility-button patient-add-trigger"
                  type="button"
                  data-testid="open-add-patient-button"
                  aria-expanded={isAddPatientFormOpen}
                  aria-label="Add patient"
                  onClick={handleOpenAddPatientForm}
                >
                  {isAddPatientFormOpen ? (
                    <>
                      <span className="button-label-mobile" aria-hidden="true">×</span>
                      <span className="button-label-desktop">Close</span>
                    </>
                  ) : (
                    <>
                      <span className="button-label-mobile" aria-hidden="true">+</span>
                      <span className="button-label-desktop">Add patient</span>
                    </>
                  )}
                </button>
              </div>
              {isAddPatientFormOpen ? (
                <form className="quick-add-patient-form" onSubmit={(event) => void handleAddPatientSubmit(event)}>
                  <label className="quick-add-patient-field">
                    <span>New patient name</span>
                    <input
                      data-testid="header-patient-display-name-input"
                      type="text"
                      value={newPatientDisplayName}
                      onChange={(event) => setNewPatientDisplayName(event.target.value)}
                      placeholder="Add patient name"
                      autoFocus
                    />
                  </label>
                  {newPatientError ? <p className="form-error quick-add-patient-error">{newPatientError}</p> : null}
                  <div className="quick-add-patient-actions">
                    <button
                      type="submit"
                      className="utility-button"
                      data-testid="header-save-patient-button"
                      disabled={isAddPatientInProgress}
                    >
                      {isAddPatientInProgress ? 'Adding...' : 'Save patient'}
                    </button>
                    <button
                      type="button"
                      className="utility-button"
                      disabled={isAddPatientInProgress}
                      onClick={resetAddPatientForm}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="workspace-context-header">
              <p className="workspace-context-eyebrow">App workspace</p>
              <p className="workspace-context-title">{activeView === 'patients' ? 'Patients' : 'More'}</p>
            </div>
          )}
        </div>
        {uiError ? <p className="header-error">{uiError}</p> : null}
        {activeAlarm ? (
          <section className="alarm-banner" data-testid="alarm-banner">
            <p className="alarm-banner-title">Alarm: {activeAlarm.medicationName} is due now</p>
            <p className="alarm-banner-meta">
              Next eligible {formatRelativeTime(new Date(activeAlarm.nextEligibleAtIso), now)}
            </p>
            <div className="alarm-banner-actions">
              <button className="utility-button" onClick={acknowledgeActiveAlarm} data-testid="alarm-acknowledge-button">
                Acknowledge
              </button>
              <button className="utility-button" onClick={snoozeActiveAlarm} data-testid="alarm-snooze-button">
                Snooze 5 min
              </button>
            </div>
          </section>
        ) : null}
      </header>

      <nav className="bottom-nav no-print" aria-label="Primary views">
        <div className="bottom-nav-group" aria-label="Patient views">
          <p className="bottom-nav-group-label">Patient</p>
          <div className="bottom-nav-group-items">
            <button className={`bottom-nav-item ${activeView === 'care' ? 'is-active' : ''}`} data-testid="tab-care" onClick={() => setView('care')}>
              <span className="nav-icon" aria-hidden="true">💊</span>
              <span className="nav-label">Care</span>
            </button>
            <button className={`bottom-nav-item ${activeView === 'history' ? 'is-active' : ''}`} data-testid="tab-history" onClick={() => setView('history')}>
              <span className="nav-icon" aria-hidden="true">📋</span>
              <span className="nav-label">History</span>
            </button>
            <button className={`bottom-nav-item ${activeView === 'meds' ? 'is-active' : ''}`} data-testid="tab-meds" onClick={() => setView('meds')}>
              <span className="nav-icon" aria-hidden="true">✏️</span>
              <span className="nav-label">Meds</span>
            </button>
          </div>
        </div>
        <div className="bottom-nav-divider" aria-hidden="true" />
        <div className="bottom-nav-group" aria-label="App views">
          <p className="bottom-nav-group-label">App</p>
          <div className="bottom-nav-group-items">
            <button className={`bottom-nav-item ${activeView === 'patients' ? 'is-active' : ''}`} data-testid="tab-patients" onClick={() => setView('patients')}>
              <span className="nav-icon" aria-hidden="true">👥</span>
              <span className="nav-label">Patients</span>
            </button>
            <button className={`bottom-nav-item ${activeView === 'more' ? 'is-active' : ''}`} data-testid="tab-more" onClick={() => setView('more')}>
              <span className="nav-icon" aria-hidden="true">⚙️</span>
              <span className="nav-label">More</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="main-content-scroll">
        {activeView === 'care' ? (
          <CareView
            patient={patient}
            medicationsForPatient={medicationsForPatient}
            allMedications={appState.medications}
            doseEvents={appState.doseEvents}
            now={now}
            onAddMedication={() => {
              setOpenMedicationFormRequestId((current) => current + 1)
              setView('meds')
            }}
            onGiveDose={handleLogDoseNow}
            onCorrectDose={handleCorrectDose}
            onDeleteDose={handleDeleteDose}
            onToggleMedicationReminder={handleToggleMedicationReminder}
            onTogglePatientNotifications={handleTogglePatientNotifications}
            actionsDisabled={isDoseActionInProgress}
          />
        ) : null}

        {activeView === 'history' ? (
          <HistoryView patient={patient} medications={appState.medications} doseEvents={appState.doseEvents} now={now} />
        ) : null}

        {activeView === 'meds' ? (
          <MedsView
            openMedicationFormRequestId={openMedicationFormRequestId}
            onOpenMedicationFormHandled={() => setOpenMedicationFormRequestId(0)}
            selectedPatientId={selectedPatientId}
            patientDisplayName={patient.displayName}
            patient={patient}
            medicationsForAdministration={medicationsForAdministration}
            doseEvents={appState.doseEvents}
            now={now}
            onCreateMedication={handleCreateMedication}
            onUpdateMedication={handleUpdateMedication}
            onActivateMedication={handleActivateMedication}
            onDeactivateMedication={handleDeactivateMedication}
            onDeleteMedication={handleDeleteMedication}
            onToggleMedicationReminder={handleToggleMedicationReminder}
            onUiError={setUiError}
          />
        ) : null}

        {activeView === 'patients' ? (
          <PatientsView
            patients={appState.patients}
            onDataChanged={refreshSelectedPatientView}
            onUiError={setUiError}
            onCreatePatient={handleCreatePatient}
            onUpdatePatient={handleUpdatePatient}
            onTogglePatientNotifications={handleTogglePatientNotifications}
            onDeletePatient={handleDeletePatient}
          />
        ) : null}

        {activeView === 'more' ? (
          <MoreView
            onDataChanged={refreshSelectedPatientView}
            notificationPermission={notificationPermission}
            requestNotificationPermission={requestNotificationPermission}
            installPromptAvailable={installPromptAvailable}
            isInstalled={isInstalled}
            onInstallApp={handleInstallApp}
            wakeLockSupported={wakeLockSupported}
            isWakeLockActive={isWakeLockActive}
            onToggleWakeLock={handleToggleWakeLock}
            onTestAlarm={triggerAlarmPreview}
            authState={authState}
            isAuthLoading={isAuthLoading}
            isAuthActionInProgress={isAuthActionInProgress}
            authSessions={authSessions}
            isAuthSessionsLoading={isAuthSessionsLoading}
            authError={authError}
            onCreateAccount={createAccount}
            onSignIn={signIn}
            onSignOut={signOut}
            onChangePassword={changePassword}
            onRequestPasswordReset={requestPasswordReset}
            onResetPassword={resetPassword}
            onUpdateAccountSettings={updateAccountSettings}
            onRefreshAuthSessions={refreshAuthSessions}
            onRevokeOtherAuthSessions={revokeOtherAuthSessions}
            onClearAuthError={clearAuthError}
          />
        ) : null}
      </main>
    </div>
  )
}

export default App
