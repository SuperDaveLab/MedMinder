import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type { AccountSessionSummary, AuthSessionState } from '../../domain/auth'
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
  authSessions: AccountSessionSummary[]
  isAuthSessionsLoading: boolean
  authError: string | null
  onCreateAccount: (credentials: { email: string; password: string }) => Promise<void>
  onSignIn: (credentials: { email: string; password: string }) => Promise<void>
  onSignOut: () => Promise<void>
  onChangePassword: (input: {
    currentPassword: string
    newPassword: string
  }) => Promise<void>
  onRequestPasswordReset: (input: {
    email: string
  }) => Promise<void>
  onResetPassword: (input: {
    token: string
    newPassword: string
  }) => Promise<void>
  onUpdateAccountSettings: (input: {
    phoneE164: string | null
    notificationDeliveryPolicy: NotificationDeliveryPolicy
  }) => Promise<void>
  onRefreshAuthSessions: () => Promise<void>
  onRevokeOtherAuthSessions: () => Promise<void>
  onClearAuthError: () => void
}

function formatSessionTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp)

  if (Number.isNaN(timestamp)) {
    return 'Unknown'
  }

  return new Date(timestamp).toLocaleString()
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
  authSessions,
  isAuthSessionsLoading,
  authError,
  onCreateAccount,
  onSignIn,
  onSignOut,
  onChangePassword,
  onRequestPasswordReset,
  onResetPassword,
  onUpdateAccountSettings,
  onRefreshAuthSessions,
  onRevokeOtherAuthSessions,
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
  const [forgotPasswordEmailInput, setForgotPasswordEmailInput] = useState('')
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('')
  const [authPhoneInput, setAuthPhoneInput] = useState('')
  const [authNotificationPolicyInput, setAuthNotificationPolicyInput] = useState<NotificationDeliveryPolicy>('push_then_email_fallback')
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') ?? '')
  const [passwordStatusMessage, setPasswordStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const [recoveryStatusMessage, setRecoveryStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)
  const [sessionStatusMessage, setSessionStatusMessage] = useState<{
    kind: 'error' | 'success'
    text: string
  } | null>(null)


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

  const handleRequestPasswordReset = async () => {
    onClearAuthError()
    setRecoveryStatusMessage(null)

    const email = forgotPasswordEmailInput.trim() || authEmailInput.trim()

    if (!email) {
      setRecoveryStatusMessage({ kind: 'error', text: 'Email is required.' })
      return
    }

    try {
      await onRequestPasswordReset({ email })
      setForgotPasswordEmailInput(email)
      setRecoveryStatusMessage({
        kind: 'success',
        text: 'If that email exists, a password reset link has been sent.',
      })
    } catch {
      // Shared auth error handles server failures.
    }
  }

  const handleSaveAccountSettings = async () => {
    const trimmed = authPhoneInput.trim()
    await onUpdateAccountSettings({
      phoneE164: trimmed.length > 0 ? trimmed : null,
      notificationDeliveryPolicy: authNotificationPolicyInput,
    })
  }

  const handleChangePassword = async () => {
    onClearAuthError()
    setPasswordStatusMessage(null)

    if (!currentPasswordInput || !newPasswordInput || !confirmNewPasswordInput) {
      setPasswordStatusMessage({ kind: 'error', text: 'All password fields are required.' })
      return
    }

    if (newPasswordInput !== confirmNewPasswordInput) {
      setPasswordStatusMessage({ kind: 'error', text: 'New password and confirmation must match.' })
      return
    }

    if (currentPasswordInput === newPasswordInput) {
      setPasswordStatusMessage({ kind: 'error', text: 'New password must be different from current password.' })
      return
    }

    try {
      await onChangePassword({
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      })

      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setConfirmNewPasswordInput('')
      setPasswordStatusMessage({ kind: 'success', text: 'Password updated.' })
    } catch {
      // Shared auth error handles server failures.
    }
  }

  const handleResetPassword = async () => {
    onClearAuthError()
    setRecoveryStatusMessage(null)

    if (!resetToken) {
      setRecoveryStatusMessage({ kind: 'error', text: 'Password reset token is missing.' })
      return
    }

    if (!newPasswordInput || !confirmNewPasswordInput) {
      setRecoveryStatusMessage({ kind: 'error', text: 'New password and confirmation are required.' })
      return
    }

    if (newPasswordInput !== confirmNewPasswordInput) {
      setRecoveryStatusMessage({ kind: 'error', text: 'New password and confirmation must match.' })
      return
    }

    try {
      await onResetPassword({
        token: resetToken,
        newPassword: newPasswordInput,
      })

      setAuthPasswordInput('')
      setNewPasswordInput('')
      setConfirmNewPasswordInput('')
      setResetToken('')
      setIsForgotPasswordMode(false)
      setRecoveryStatusMessage({ kind: 'success', text: 'Password reset. Sign in with your new password.' })

      const searchParams = new URLSearchParams(window.location.search)
      searchParams.delete('resetToken')
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', nextUrl)
    } catch {
      // Shared auth error handles server failures.
    }
  }

  const handleRevokeOtherSessions = async () => {
    onClearAuthError()
    setSessionStatusMessage(null)

    try {
      await onRevokeOtherAuthSessions()
      setSessionStatusMessage({ kind: 'success', text: 'Signed out other devices.' })
    } catch {
      setSessionStatusMessage({ kind: 'error', text: 'Unable to sign out other devices right now.' })
    }
  }

  useEffect(() => {
    setAuthPhoneInput(authState?.account.phoneE164 ?? '')
    setAuthNotificationPolicyInput(authState?.account.notificationDeliveryPolicy ?? 'push_then_email_fallback')
  }, [authState?.account.notificationDeliveryPolicy, authState?.account.phoneE164])

  useEffect(() => {
    if (!authState) {
      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setConfirmNewPasswordInput('')
      setPasswordStatusMessage(null)
      setSessionStatusMessage(null)
    }
  }, [authState])

  useEffect(() => {
    if (!authState) {
      return
    }

    setSessionStatusMessage(null)
    void onRefreshAuthSessions().catch(() => {
      // Shared auth error handles server failures.
    })
  }, [authState, onRefreshAuthSessions])

  useEffect(() => {
    if (authState) {
      setRecoveryStatusMessage(null)
      setIsForgotPasswordMode(false)
      return
    }

    setForgotPasswordEmailInput(authEmailInput.trim())
  }, [authEmailInput, authState])

  useEffect(() => {
    if (resetToken) {
      setIsForgotPasswordMode(false)
      setRecoveryStatusMessage(null)
    }
  }, [resetToken])

  const accountSection = (
    <section className="admin-section no-print account-section" data-testid="account-section">
      <h2>Account (optional cloud sync)</h2>
      {isAuthLoading ? <p className="subhead">Loading account state...</p> : null}
      {!isAuthLoading && authState ? (
        <>
          <div className="account-section-header">
            <p className="subhead">Signed in as {authState.account.email}</p>
            <p className="subhead">Cloud sync and premium reminder features can be enabled for this account.</p>
          </div>
          <div className="account-grid">
            <section className="account-card account-preferences-card">
              <div className="account-card-header">
                <p className="account-card-eyebrow">Delivery</p>
                <h3>Delivery and contact</h3>
                <p>Set how reminder relay should reach you and keep your backup contact info ready for later account features.</p>
              </div>
              <div className="account-card-body">
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
                <p className="account-field-hint">
                  Default recommended: Push first, then email only if push delivers to zero subscriptions.
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
              </div>
              <div className="account-card-actions form-actions">
                <button
                  className="utility-button"
                  data-testid="save-account-settings-button"
                  disabled={isAuthActionInProgress}
                  onClick={() => void handleSaveAccountSettings()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Save notification settings'}
                </button>
                <button
                  className="utility-button security-action-button"
                  data-testid="sign-out-button"
                  disabled={isAuthActionInProgress}
                  onClick={() => void onSignOut()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Sign out'}
                </button>
              </div>
            </section>

            <section className="account-card account-password-panel">
              <div className="account-card-header">
                <p className="account-card-eyebrow">Password</p>
                <h3>Change password</h3>
                <p>Update your password without signing out on this device. Other signed-in sessions will be revoked.</p>
              </div>
              <div className="account-card-body">
                <label>
                  Current password
                  <input
                    data-testid="current-password-input"
                    type="password"
                    value={currentPasswordInput}
                    onChange={(event) => {
                      onClearAuthError()
                      setPasswordStatusMessage(null)
                      setCurrentPasswordInput(event.target.value)
                    }}
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  New password
                  <input
                    data-testid="new-password-input"
                    type="password"
                    value={newPasswordInput}
                    onChange={(event) => {
                      onClearAuthError()
                      setPasswordStatusMessage(null)
                      setNewPasswordInput(event.target.value)
                    }}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    data-testid="confirm-new-password-input"
                    type="password"
                    value={confirmNewPasswordInput}
                    onChange={(event) => {
                      onClearAuthError()
                      setPasswordStatusMessage(null)
                      setConfirmNewPasswordInput(event.target.value)
                    }}
                    autoComplete="new-password"
                  />
                </label>
                {passwordStatusMessage ? (
                  <p className={passwordStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
                    {passwordStatusMessage.text}
                  </p>
                ) : null}
                {authError ? <p className="form-error">{authError}</p> : null}
              </div>
              <div className="account-card-actions">
                <button
                  className="utility-button"
                  data-testid="change-password-button"
                  disabled={isAuthActionInProgress}
                  onClick={() => void handleChangePassword()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Change password'}
                </button>
              </div>
            </section>

            <section className="account-card account-session-panel" data-testid="account-sessions-panel">
              <div className="account-card-header">
                <p className="account-card-eyebrow">Sessions</p>
                <h3>Session activity</h3>
                <p>Review active sessions and sign out other devices when needed.</p>
              </div>
              <div className="account-card-body">
                {isAuthSessionsLoading ? <p className="account-field-hint">Loading active sessions...</p> : null}
                {!isAuthSessionsLoading && authSessions.length === 0 ? (
                  <p className="account-field-hint">No active sessions found.</p>
                ) : null}
                {authSessions.length > 0 ? (
                  <ul className="session-list" data-testid="account-session-list">
                    {authSessions.map((session) => (
                      <li key={session.sessionId} className="session-item">
                        <p>
                          <strong>{session.isCurrent ? 'Current device' : 'Other device'}</strong>
                          <span className={`session-badge ${session.isCurrent ? 'is-current' : ''}`}>
                            {session.provider}
                          </span>
                        </p>
                        <p>Signed in: {formatSessionTime(session.issuedAt)}</p>
                        <p>Expires: {formatSessionTime(session.expiresAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {sessionStatusMessage ? (
                  <p className={sessionStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
                    {sessionStatusMessage.text}
                  </p>
                ) : null}
              </div>
              <div className="account-card-actions form-actions">
                <button
                  className="utility-button security-action-button"
                  data-testid="revoke-other-sessions-button"
                  disabled={
                    isAuthActionInProgress
                    || isAuthSessionsLoading
                    || authSessions.filter((session) => !session.isCurrent).length === 0
                  }
                  onClick={() => void handleRevokeOtherSessions()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Sign out other devices'}
                </button>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {!isAuthLoading && !authState ? (
        <>
          <div className="account-section-header">
            <p className="subhead">Create an account to opt into cloud backup/sync and premium reminder delivery.</p>
          </div>
          <div className="account-grid">
            <section className="account-card account-auth-card">
              <div className="account-card-header">
                <p className="account-card-eyebrow">Access</p>
                <h3>{resetToken ? 'Reset your password' : 'Sign in or create account'}</h3>
                <p>
                  {resetToken
                    ? 'Choose a new password for this account.'
                    : 'Use the same form to sign in now or create an account for cloud sync.'}
                </p>
              </div>
              <div className="account-card-body">
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
                {!resetToken ? (
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
                ) : null}
                {recoveryStatusMessage && !resetToken && !isForgotPasswordMode ? (
                  <p className={recoveryStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
                    {recoveryStatusMessage.text}
                  </p>
                ) : null}
                {authError && !isForgotPasswordMode && !resetToken ? <p className="form-error">{authError}</p> : null}
              </div>
              <div className="account-card-actions form-actions">
                <button
                  className="utility-button"
                  data-testid="create-account-button"
                  disabled={isAuthActionInProgress || Boolean(resetToken)}
                  onClick={() => void handleCreateAccount()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Create account'}
                </button>
                <button
                  className="utility-button"
                  data-testid="sign-in-button"
                  disabled={isAuthActionInProgress || Boolean(resetToken)}
                  onClick={() => void handleSignIn()}
                >
                  {isAuthActionInProgress ? 'Working...' : 'Sign in'}
                </button>
                {!resetToken ? (
                  <button
                    className="utility-button"
                    data-testid="forgot-password-button"
                    disabled={isAuthActionInProgress}
                    onClick={() => {
                      onClearAuthError()
                      setRecoveryStatusMessage(null)
                      setForgotPasswordEmailInput(authEmailInput.trim())
                      setIsForgotPasswordMode((previous) => !previous)
                    }}
                  >
                    {isForgotPasswordMode ? 'Hide reset form' : 'Forgot password'}
                  </button>
                ) : null}
              </div>
            </section>

            {resetToken ? (
              <section className="account-card account-password-panel">
                <div className="account-card-header">
                  <p className="account-card-eyebrow">Password</p>
                  <h3>Reset password</h3>
                  <p>This reset link can only be used once. Choose a new password to finish recovery.</p>
                </div>
                <div className="account-card-body">
                  <label>
                    New password
                    <input
                      data-testid="reset-password-input"
                      type="password"
                      value={newPasswordInput}
                      onChange={(event) => {
                        onClearAuthError()
                        setRecoveryStatusMessage(null)
                        setNewPasswordInput(event.target.value)
                      }}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Confirm new password
                    <input
                      data-testid="reset-password-confirm-input"
                      type="password"
                      value={confirmNewPasswordInput}
                      onChange={(event) => {
                        onClearAuthError()
                        setRecoveryStatusMessage(null)
                        setConfirmNewPasswordInput(event.target.value)
                      }}
                      autoComplete="new-password"
                    />
                  </label>
                  {recoveryStatusMessage ? (
                    <p className={recoveryStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
                      {recoveryStatusMessage.text}
                    </p>
                  ) : null}
                  {authError ? <p className="form-error">{authError}</p> : null}
                </div>
                <div className="account-card-actions">
                  <button
                    className="utility-button"
                    data-testid="reset-password-button"
                    disabled={isAuthActionInProgress}
                    onClick={() => void handleResetPassword()}
                  >
                    {isAuthActionInProgress ? 'Working...' : 'Reset password'}
                  </button>
                </div>
              </section>
            ) : null}

            {!resetToken && isForgotPasswordMode ? (
              <section className="account-card account-password-panel">
                <div className="account-card-header">
                  <p className="account-card-eyebrow">Recovery</p>
                  <h3>Forgot password</h3>
                  <p>Enter your account email and we will send a reset link once email delivery is available.</p>
                </div>
                <div className="account-card-body">
                  <label>
                    Recovery email
                    <input
                      data-testid="forgot-password-email-input"
                      type="email"
                      value={forgotPasswordEmailInput}
                      onChange={(event) => {
                        onClearAuthError()
                        setRecoveryStatusMessage(null)
                        setForgotPasswordEmailInput(event.target.value)
                      }}
                      autoComplete="email"
                    />
                  </label>
                  {recoveryStatusMessage ? (
                    <p className={recoveryStatusMessage.kind === 'error' ? 'form-error' : 'form-success'}>
                      {recoveryStatusMessage.text}
                    </p>
                  ) : null}
                  {authError ? <p className="form-error">{authError}</p> : null}
                </div>
                <div className="account-card-actions form-actions">
                  <button
                    className="utility-button"
                    data-testid="request-password-reset-button"
                    disabled={isAuthActionInProgress}
                    onClick={() => void handleRequestPasswordReset()}
                  >
                    {isAuthActionInProgress ? 'Working...' : 'Send reset link'}
                  </button>
                  <button
                    className="utility-button"
                    data-testid="cancel-forgot-password-button"
                    disabled={isAuthActionInProgress}
                    onClick={() => {
                      onClearAuthError()
                      setRecoveryStatusMessage(null)
                      setIsForgotPasswordMode(false)
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </section>
            ) : null}
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
            {notificationPermission !== 'granted' ? (
              <section className="settings-item">
                <div>
                  <h3 className="settings-title">
                    <span className="settings-icon" aria-hidden="true">🔔</span>
                    <span>Due alerts</span>
                  </h3>
                  <p>
                    {notificationPermission === 'unsupported'
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
                  {notificationPermission === 'unsupported'
                    ? 'Notifications unsupported'
                    : notificationPermission === 'denied'
                      ? 'Notifications denied'
                      : 'Enable due alerts'}
                </button>
              </section>
            ) : null}

            {installPromptAvailable && !isInstalled ? (
              <section className="settings-item">
                <div>
                  <h3 className="settings-title">
                    <span className="settings-icon" aria-hidden="true">📲</span>
                    <span>Install app</span>
                  </h3>
                  <p>Install is available for quick launch.</p>
                </div>
                <button
                  className="utility-button settings-action-button"
                  onClick={() => void onInstallApp()}
                  data-testid="install-app-button"
                >
                  Install app
                </button>
              </section>
            ) : null}

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
            <p><strong>App:</strong> Med-Minder</p>
            <p><strong>Created by:</strong> Super Dave</p>
            <p><strong>Source:</strong> <a href="https://github.com/SuperDaveLab/MedMinder" target="_blank" rel="noopener noreferrer">github.com/SuperDaveLab/MedMinder</a></p>
            <p><strong>Install mode:</strong> {isInstalled ? 'Installed PWA' : 'Browser tab'}</p>
            <p><strong>Notification permission:</strong> {String(notificationPermission)}</p>
          </div>
        </section>
      </section>

    </>
  )
}
