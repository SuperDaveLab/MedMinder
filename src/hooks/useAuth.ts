import { useCallback, useEffect, useMemo, useState } from 'react'
import { createAuthApiClient } from '../cloud/authClient'
import { bootstrapCloudFromLocal, startCloudSession } from '../cloud/syncOrchestrator'
import type { AccountSessionSummary, AuthSessionState } from '../domain/auth'
import type { NotificationDeliveryPolicy } from '../domain/notificationPolicy'
import { unregisterPushSubscription } from '../reminders/pushRelay'
import { clearLocalClinicalData } from '../storage/repository'
import {
  clearAuthSessionState,
  getAuthSessionState,
  saveAuthSessionState,
} from '../storage/authSession'

interface AuthCredentials {
  email: string
  password: string
}

interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

interface RequestPasswordResetInput {
  email: string
}

interface ResetPasswordInput {
  token: string
  newPassword: string
}

export interface UseAuthResult {
  authState: AuthSessionState | null
  isAuthLoading: boolean
  isAuthActionInProgress: boolean
  authSessions: AccountSessionSummary[]
  isAuthSessionsLoading: boolean
  authError: string | null
  createAccount: (credentials: AuthCredentials) => Promise<void>
  signIn: (credentials: AuthCredentials) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (input: ChangePasswordInput) => Promise<void>
  requestPasswordReset: (input: RequestPasswordResetInput) => Promise<void>
  resetPassword: (input: ResetPasswordInput) => Promise<void>
  updateAccountSettings: (input: {
    phoneE164: string | null
    notificationDeliveryPolicy: NotificationDeliveryPolicy
  }) => Promise<void>
  refreshAuthSessions: () => Promise<void>
  revokeOtherAuthSessions: () => Promise<void>
  emailExport: (payload: { filename: string; content: string; mimeType: string }) => Promise<void>
  clearAuthError: () => void
}

function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function getApiBaseUrl(): string {
  return String(import.meta.env.VITE_API_BASE_URL ?? '')
}

export function useAuth(): UseAuthResult {
  const [authState, setAuthState] = useState<AuthSessionState | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [isAuthActionInProgress, setIsAuthActionInProgress] = useState(false)
  const [authSessions, setAuthSessions] = useState<AccountSessionSummary[]>([])
  const [isAuthSessionsLoading, setIsAuthSessionsLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const authClient = useMemo(() => createAuthApiClient(getApiBaseUrl()), [])

  useEffect(() => {
    let canceled = false

    const loadPersistedSession = async () => {
      try {
        const stored = await getAuthSessionState()

        if (!canceled) {
          setAuthState(stored)
          setAuthSessions([])
        }
      } finally {
        if (!canceled) {
          setIsAuthLoading(false)
        }
      }
    }

    void loadPersistedSession()

    return () => {
      canceled = true
    }
  }, [])

  const createAccount = useCallback(async (credentials: AuthCredentials) => {
    const email = credentials.email.trim()

    if (!email || !credentials.password) {
      setAuthError('Email and password are required.')
      return
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      const response = await authClient.createAccount({
        email,
        password: credentials.password,
        timezone: getDefaultTimezone(),
      })

      const nextState: AuthSessionState = {
        account: response.account,
        session: response.session,
        tokens: response.tokens,
      }

      const profile = await authClient.getAccountProfile(nextState.session.sessionId)
      const resolvedState: AuthSessionState = {
        ...nextState,
        account: profile,
      }

      await bootstrapCloudFromLocal(resolvedState)
      await saveAuthSessionState(resolvedState)
      setAuthState(resolvedState)
      setAuthSessions([])
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to create account right now.')
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient])

  const signIn = useCallback(async (credentials: AuthCredentials) => {
    const email = credentials.email.trim()

    if (!email || !credentials.password) {
      setAuthError('Email and password are required.')
      return
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      const response = await authClient.signInWithPassword({
        email,
        password: credentials.password,
        timezone: getDefaultTimezone(),
      })

      const nextState: AuthSessionState = {
        account: response.account,
        session: response.session,
        tokens: response.tokens,
      }

      const profile = await authClient.getAccountProfile(nextState.session.sessionId)
      const resolvedState: AuthSessionState = {
        ...nextState,
        account: profile,
      }

      await startCloudSession(resolvedState)
      await saveAuthSessionState(resolvedState)
      setAuthState(resolvedState)
      setAuthSessions([])
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in right now.')
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient])

  const updateAccountSettings = useCallback(async (input: {
    phoneE164: string | null
    notificationDeliveryPolicy: NotificationDeliveryPolicy
  }) => {
    if (!authState) {
      setAuthError('You need to sign in before updating account settings.')
      return
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      const updatedAccount = await authClient.updateAccountProfile(
        authState.session.sessionId,
        {
          phoneE164: input.phoneE164,
          notificationDeliveryPolicy: input.notificationDeliveryPolicy,
        },
      )

      const nextState: AuthSessionState = {
        ...authState,
        account: updatedAccount,
      }

      await saveAuthSessionState(nextState)
      setAuthState(nextState)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to update account settings.')
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient, authState])

  const signOut = useCallback(async () => {
    if (!authState) {
      await clearAuthSessionState()
      setAuthState(null)
      setAuthError(null)
      return
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      await unregisterPushSubscription(authState)
      await authClient.signOut({ sessionId: authState.session.sessionId })
    } catch {
      // Even if remote sign-out fails, clear local session to avoid lock-in.
    } finally {
      await clearLocalClinicalData()
      await clearAuthSessionState()
      setAuthState(null)
      setAuthSessions([])
      setIsAuthActionInProgress(false)
    }
  }, [authClient, authState])

  const refreshAuthSessions = useCallback(async () => {
    if (!authState) {
      setAuthSessions([])
      return
    }

    setAuthError(null)
    setIsAuthSessionsLoading(true)

    try {
      const sessions = await authClient.listAccountSessions(authState.session.sessionId)
      setAuthSessions(sessions)
    } catch (error) {
      const resolvedError = error instanceof Error
        ? error
        : new Error('Unable to refresh account sessions right now.')
      setAuthError(resolvedError.message)
      throw resolvedError
    } finally {
      setIsAuthSessionsLoading(false)
    }
  }, [authClient, authState])

  const revokeOtherAuthSessions = useCallback(async () => {
    if (!authState) {
      const error = new Error('You need to sign in before managing sessions.')
      setAuthError(error.message)
      throw error
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      await authClient.revokeOtherSessions(authState.session.sessionId)
      const sessions = await authClient.listAccountSessions(authState.session.sessionId)
      setAuthSessions(sessions)
    } catch (error) {
      const resolvedError = error instanceof Error
        ? error
        : new Error('Unable to revoke other sessions right now.')
      setAuthError(resolvedError.message)
      throw resolvedError
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient, authState])

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    if (!authState) {
      const error = new Error('You need to sign in before changing password.')
      setAuthError(error.message)
      throw error
    }

    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      await authClient.changePassword(authState.session.sessionId, input)
    } catch (error) {
      const resolvedError = error instanceof Error
        ? error
        : new Error('Unable to change password right now.')
      setAuthError(resolvedError.message)
      throw resolvedError
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient, authState])

  const requestPasswordReset = useCallback(async (input: RequestPasswordResetInput) => {
    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      await authClient.requestPasswordReset({ email: input.email.trim() })
    } catch (error) {
      const resolvedError = error instanceof Error
        ? error
        : new Error('Unable to request password reset right now.')
      setAuthError(resolvedError.message)
      throw resolvedError
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient])

  const resetPassword = useCallback(async (input: ResetPasswordInput) => {
    setAuthError(null)
    setIsAuthActionInProgress(true)

    try {
      await authClient.resetPassword(input)
    } catch (error) {
      const resolvedError = error instanceof Error
        ? error
        : new Error('Unable to reset password right now.')
      setAuthError(resolvedError.message)
      throw resolvedError
    } finally {
      setIsAuthActionInProgress(false)
    }
  }, [authClient])

  const clearAuthError = useCallback(() => {
    setAuthError(null)
  }, [])

  const emailExport = useCallback(async (payload: { filename: string; content: string; mimeType: string }) => {
    if (!authState) {
      throw new Error('You need to sign in before emailing an export.')
    }
    await authClient.emailExport(authState.session.sessionId, payload)
  }, [authClient, authState])

  return {
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
    emailExport,
    clearAuthError,
  }
}
