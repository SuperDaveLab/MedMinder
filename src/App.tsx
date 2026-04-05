import { useAppData } from './hooks/useAppData'
import { useAppShell } from './hooks/useAppShell'
import { CareView } from './features/care/CareView'
import { HistoryView } from './features/history/HistoryView'
import { MedsView } from './features/meds/MedsView'
import { MoreView } from './features/more/MoreView'
import { formatRelativeTime } from './ui/time'
import './App.css'

function App() {
  const {
    appState,
    selectedPatientId,
    now,
    uiError,
    isDoseActionInProgress,
    refreshSelectedPatientView,
    handlePatientChange,
    handleLogDoseNow,
    handleCorrectDose,
    setUiError,
  } = useAppData()

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
  } = useAppShell({ appState, now })

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
          <MoreView
            noPatientsMode
            patients={appState.patients}
            selectedPatientId={selectedPatientId}
            patient={null}
            medicationsForPatient={[]}
            doseEvents={appState.doseEvents}
            now={now}
            onDataChanged={refreshSelectedPatientView}
            onUiError={setUiError}
            notificationPermission={notificationPermission}
            requestNotificationPermission={requestNotificationPermission}
            installPromptAvailable={installPromptAvailable}
            isInstalled={isInstalled}
            onInstallApp={handleInstallApp}
            wakeLockSupported={wakeLockSupported}
            isWakeLockActive={isWakeLockActive}
            onToggleWakeLock={handleToggleWakeLock}
            onTestAlarm={triggerAlarmPreview}
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

  return (
    <div className="layout-root">
      <header className="top-app-bar no-print">
        <label className="patient-selector-compact">
          <span className="patient-avatar" aria-hidden="true">👤</span>
          <select value={patient.id} onChange={(event) => void handlePatientChange(event.target.value)}>
            {appState.patients.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </label>
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
        <button className={`bottom-nav-item ${activeView === 'more' ? 'is-active' : ''}`} data-testid="tab-more" onClick={() => setView('more')}>
          <span className="nav-icon" aria-hidden="true">⚙️</span>
          <span className="nav-label">More</span>
        </button>
      </nav>

      <main className="main-content-scroll">
        {activeView === 'care' ? (
          <CareView
            patient={patient}
            medicationsForPatient={medicationsForPatient}
            allMedications={appState.medications}
            doseEvents={appState.doseEvents}
            now={now}
            onGiveDose={handleLogDoseNow}
            onCorrectDose={handleCorrectDose}
            actionsDisabled={isDoseActionInProgress}
          />
        ) : null}

        {activeView === 'history' ? (
          <HistoryView patient={patient} medications={appState.medications} doseEvents={appState.doseEvents} now={now} />
        ) : null}

        {activeView === 'meds' ? (
          <MedsView
            selectedPatientId={selectedPatientId}
            medicationsForAdministration={medicationsForAdministration}
            onDataChanged={refreshSelectedPatientView}
            onUiError={setUiError}
          />
        ) : null}

        {activeView === 'more' ? (
          <MoreView
            patients={appState.patients}
            selectedPatientId={selectedPatientId}
            patient={patient}
            medicationsForPatient={medicationsForPatient}
            doseEvents={appState.doseEvents}
            now={now}
            onDataChanged={refreshSelectedPatientView}
            onUiError={setUiError}
            notificationPermission={notificationPermission}
            requestNotificationPermission={requestNotificationPermission}
            installPromptAvailable={installPromptAvailable}
            isInstalled={isInstalled}
            onInstallApp={handleInstallApp}
            wakeLockSupported={wakeLockSupported}
            isWakeLockActive={isWakeLockActive}
            onToggleWakeLock={handleToggleWakeLock}
            onTestAlarm={triggerAlarmPreview}
          />
        ) : null}
      </main>
    </div>
  )
}

export default App
