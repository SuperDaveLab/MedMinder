import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type { AuthSessionState } from '../../domain/auth'
import {
  getNotificationDeliveryPolicyLabel,
  notificationDeliveryPolicies,
  type NotificationDeliveryPolicy,
} from '../../domain/notificationPolicy'
import {
  exportFullBackup,
  importFullBackup,
} from '../../storage/repository'
import { validateBackup } from '../../storage/backup'

interface MoreViewProps {
  onDataChanged: (preferredPatientId?: string | null) => Promise<void>
  notificationPermission: NotificationPermission | 'unsupported'
  requestNotificationPermission: () => Promise<void>
  installPromptAvailable: boolean
  isInstalled: boolean
  onInstallApp: () => Promise<void>
  wakeLockSupported: boolean
  isWakeLockActive: boolean
  onToggleWakeLock: () => Promise<void>
  onTestAlarm: () => void
  authState: AuthSessionState | null
  isAuthLoading: boolean
  isAuthActionInProgress: boolean
  authError: string | null
  onCreateAccount: (credentials: { email: string; password: string }) => Promise<void>
  onSignIn: (credentials: { email: string; password: string }) => Promise<void>
  onSignOut: () => Promise<void>
  onUpdateAccountSettings: (input: {
    phoneE164: string | null
    notificationDeliveryPolicy: NotificationDeliveryPolicy
  }) => Promise<void>
  onClearAuthError: () => void
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = objectUrl
  downloadLink.download = fileName
  downloadLink.click()
  URL.revokeObjectURL(objectUrl)
}

export function MoreView({
  onDataChanged,
  notificationPermission,
  requestNotificationPermission,
  installPromptAvailable,
  isInstalled,
  onInstallApp,
  wakeLockSupported,
  isWakeLockActive,
  onToggleWakeLock,
  onTestAlarm,
  authState,
  isAuthLoading,
  isAuthActionInProgress,
  authError,
  onCreateAccount,
  onSignIn,
  onSignOut,
  onUpdateAccountSettings,
  onClearAuthError,
}: MoreViewProps) {
  const [isBackupActionInProgress, setIsBackupActionInProgress] = useState(false)
  const [backupStatusMessage, setBackupStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const backupFileInputRef = useRef<HTMLInputElement>(null)
  const [authEmailInput, setAuthEmailInput] = useState('')
  const [authPasswordInput, setAuthPasswordInput] = useState('')
  const [authPhoneInput, setAuthPhoneInput] = useState('')
  const [authNotificationPolicyInput, setAuthNotificationPolicyInput] = useState<NotificationDeliveryPolicy>('push_then_email_fallback')


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

    if (typeof navigator.share !== 'function') {
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
    event.target.value = ''
    if (!file) return
    if (isBackupActionInProgress) return
    setBackupStatusMessage(null)

    let text: string
    try {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (readerEvent) => resolve(readerEvent.target?.result as string)
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
      await onDataChanged(null)
      setBackupStatusMessage({ kind: 'success', text: 'Backup restored successfully.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setBackupStatusMessage({ kind: 'error', text: `Import failed: ${message}` })
    } finally {
      setIsBackupActionInProgress(false)
    }
  }

  const handleCreateAccount = async () => {
    await onCreateAccount({
      email: authEmailInput,
      password: authPasswordInput,
    })
  }

  const handleSignIn = async () => {
    await onSignIn({
      email: authEmailInput,
      password: authPasswordInput,
    })
  }

  const handleSaveAccountSettings = async () => {
    const trimmed = authPhoneInput.trim()
    await onUpdateAccountSettings({
      phoneE164: trimmed.length > 0 ? trimmed : null,
      notificationDeliveryPolicy: authNotificationPolicyInput,
    })
  }

  useEffect(() => {
    setAuthPhoneInput(authState?.account.phoneE164 ?? '')
    setAuthNotificationPolicyInput(authState?.account.notificationDeliveryPolicy ?? 'push_then_email_fallback')
  }, [authState?.account.notificationDeliveryPolicy, authState?.account.phoneE164])

  const accountSection = (
    <section className="admin-section no-print" data-testid="account-section">
      <h2>Account (optional cloud sync)</h2>
      {isAuthLoading ? <p className="subhead">Loading account state...</p> : null}
      {!isAuthLoading && authState ? (
        <>
          <p className="subhead">Signed in as {authState.account.email}</p>
          <p className="subhead">Cloud sync and premium reminder features can be enabled for this account.</p>
          <label>
            Notification delivery
            <select
              data-testid="account-notification-policy-select"
              value={authNotificationPolicyInput}
              onChange={(event) => setAuthNotificationPolicyInput(event.target.value as NotificationDeliveryPolicy)}
            >
              {notificationDeliveryPolicies.map((policy) => (
                <option key={policy} value={policy}>
                  {getNotificationDeliveryPolicyLabel(policy)}
                </option>
              ))}
            </select>
          </label>
          <p className="subhead">
            Default recommended: Push first, then email if push does not deliver.
          </p>
          <label>
            SMS phone (E.164, e.g. +15551234567)
            <input
              data-testid="account-phone-input"
              type="tel"
              value={authPhoneInput}
              onChange={(event) => setAuthPhoneInput(event.target.value)}
              autoComplete="tel"
              placeholder="+15551234567"
            />
          </label>
          <div className="form-actions">
            <button
              className="utility-button"
              data-testid="save-account-settings-button"
              disabled={isAuthActionInProgress}
              onClick={() => void handleSaveAccountSettings()}
            >
              {isAuthActionInProgress ? 'Working...' : 'Save notification settings'}
            </button>
            <button
              className="utility-button"
              data-testid="sign-out-button"
              disabled={isAuthActionInProgress}
              onClick={() => void onSignOut()}
            >
              {isAuthActionInProgress ? 'Working...' : 'Sign out'}
            </button>
          </div>
        </>
      ) : null}

      {!isAuthLoading && !authState ? (
        <>
          <p className="subhead">Create an account to opt into cloud backup/sync and premium reminder delivery.</p>
          <label>
            Email
            <input
              data-testid="auth-email-input"
              type="email"
              value={authEmailInput}
              onChange={(event) => {
                onClearAuthError()
                setAuthEmailInput(event.target.value)
              }}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              data-testid="auth-password-input"
              type="password"
              value={authPasswordInput}
              onChange={(event) => {
                onClearAuthError()
                setAuthPasswordInput(event.target.value)
              }}
              autoComplete="current-password"
            />
          </label>
          {authError ? <p className="form-error">{authError}</p> : null}
          <div className="form-actions">
            <button
              className="utility-button"
              data-testid="create-account-button"
              disabled={isAuthActionInProgress}
              onClick={() => void handleCreateAccount()}
            >
              {isAuthActionInProgress ? 'Working...' : 'Create account'}
            </button>
            <button
              className="utility-button"
              data-testid="sign-in-button"
              disabled={isAuthActionInProgress}
              onClick={() => void handleSignIn()}
            >
              {isAuthActionInProgress ? 'Working...' : 'Sign in'}
            </button>
          </div>
        </>
      ) : null}
    </section>
  )

  return (
    <>
      <section className="workflow-section" data-testid="more-view">
        <section className="admin-section no-print app-settings-section">
          <h2>App Settings</h2>
          <div className="settings-grid">
            <section className="settings-item">
              <div>
                <h3 className="settings-title">
                  <span className="settings-icon" aria-hidden="true">🔔</span>
                  <span>Due alerts</span>
                </h3>
                <p>
                  {notificationPermission === 'granted'
                    ? 'Enabled on this device.'
                    : notificationPermission === 'unsupported'
                      ? 'This browser does not support notifications.'
                      : notificationPermission === 'denied'
                        ? 'Blocked in browser settings.'
                        : 'Enable reminders for due and overdue doses.'}
                </p>
              </div>
              <button
                className="utility-button settings-action-button"
                onClick={() => void requestNotificationPermission()}
                disabled={notificationPermission !== 'default'}
              >
                {notificationPermission === 'granted'
                  ? 'Notifications enabled'
                  : notificationPermission === 'unsupported'
                    ? 'Notifications unsupported'
                    : notificationPermission === 'denied'
                      ? 'Notifications denied'
                      : 'Enable due alerts'}
              </button>
            </section>

            <section className="settings-item">
              <div>
                <h3 className="settings-title">
                  <span className="settings-icon" aria-hidden="true">📲</span>
                  <span>Install app</span>
                </h3>
                <p>
                  {isInstalled
                    ? 'Installed and ready for home-screen use.'
                    : installPromptAvailable
                      ? 'Install is available for quick launch.'
                      : 'Install prompt is unavailable on this browser.'}
                </p>
              </div>
              <button
                className="utility-button settings-action-button"
                onClick={() => void onInstallApp()}
                disabled={!installPromptAvailable || isInstalled}
                data-testid="install-app-button"
              >
                {isInstalled ? 'App installed' : installPromptAvailable ? 'Install app' : 'Install unavailable'}
              </button>
            </section>

            <section className="settings-item">
              <div>
                <h3 className="settings-title">
                  <span className="settings-icon" aria-hidden="true">🌙</span>
                  <span>Prevent sleep</span>
                </h3>
                <p>
                  {isWakeLockActive
                    ? 'Screen wake lock is on.'
                    : wakeLockSupported
                      ? 'Keep the screen awake during active care windows.'
                      : 'Wake lock is unsupported on this device.'}
                </p>
              </div>
              <button
                className="utility-button settings-action-button"
                onClick={() => void onToggleWakeLock()}
                disabled={!wakeLockSupported}
                data-testid="wake-lock-button"
              >
                {isWakeLockActive ? 'Sleep lock: on' : 'Prevent sleep'}
              </button>
            </section>

            <section className="settings-item">
              <div>
                <h3 className="settings-title">
                  <span className="settings-icon" aria-hidden="true">🔊</span>
                  <span>Alarm check</span>
                </h3>
                <p>Play a quick test alarm to verify audio and alert behavior.</p>
              </div>
              <button
                className="utility-button settings-action-button"
                onClick={onTestAlarm}
                data-testid="test-alarm-button"
              >
                Test alarm
              </button>
            </section>
          </div>

          <p className="subhead app-settings-guidance">
            Best results: install the app, enable due alerts, and use Prevent sleep during active care windows.
          </p>
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
            onChange={(event) => void handleImportBackup(event)}
            data-testid="backup-file-input"
          />
        </section>

        {accountSection}

        <section className="admin-section no-print app-info-section" data-testid="app-info-section">
          <h2>App info</h2>
          <p className="subhead">Version {__APP_VERSION__} | Build {__APP_BUILD__}</p>
          <div className="app-info-grid">
            <p><strong>Install mode:</strong> {isInstalled ? 'Installed PWA' : 'Browser tab'}</p>
            <p><strong>Notification permission:</strong> {String(notificationPermission)}</p>
          </div>
        </section>
      </section>

    </>
  )
}
