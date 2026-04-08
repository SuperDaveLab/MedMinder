import { useCallback, useEffect, useMemo, useState } from 'react'
import { createAuthApiClient } from '../cloud/authClient'
import { bootstrapCloudFromLocal, startCloudSession } from '../cloud/syncOrchestrator'
import type { AuthSessionState } from '../domain/auth'
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

export interface UseAuthResult {
  authState: AuthSessionState | null
  isAuthLoading: boolean
  isAuthActionInProgress: boolean
  authError: string | null
  createAccount: (credentials: AuthCredentials) => Promise<void>
  signIn: (credentials: AuthCredentials) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (input: ChangePasswordInput) => Promise<void>
  updateAccountSettings: (input: {
    phoneE164: string | null
    notificationDeliveryPolicy: NotificationDeliveryPolicy
  }) => Promise<void>
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
  const [authError, setAuthError] = useState<string | null>(null)

  const authClient = useMemo(() => createAuthApiClient(getApiBaseUrl()), [])

  useEffect(() => {
    let canceled = false

    const loadPersistedSession = async () => {
      try {
        const stored = await getAuthSessionState()

        if (!canceled) {
          setAuthState(stored)
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

  const clearAuthError = useCallback(() => {
    setAuthError(null)
  }, [])

  return {
    authState,
    isAuthLoading,
    isAuthActionInProgress,
    authError,
    createAccount,
    signIn,
    signOut,
    changePassword,
    updateAccountSettings,
    clearAuthError,
  }
}
