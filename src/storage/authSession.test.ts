import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { hasValidSessionExpiry, type AuthSessionState } from '../domain/auth'
import { nexpillDb } from './database'
import {
  clearAuthSessionState,
  getAuthSessionState,
  saveAuthSessionState,
} from './authSession'

async function clearDatabase(): Promise<void> {
  await nexpillDb.transaction(
    'rw',
    nexpillDb.patients,
    nexpillDb.medications,
    nexpillDb.doseEvents,
    nexpillDb.appSettings,
    async () => {
      await nexpillDb.patients.clear()
      await nexpillDb.medications.clear()
      await nexpillDb.doseEvents.clear()
      await nexpillDb.appSettings.clear()
    },
  )
}

function buildAuthState(): AuthSessionState {
  return {
    account: {
      accountId: 'account-1',
      userId: 'user-1',
      email: 'caregiver@example.com',
      notificationDeliveryPolicy: 'push_then_email_fallback',
      createdAt: '2026-04-06T10:00:00.000Z',
    },
    session: {
      sessionId: 'session-1',
      accountId: 'account-1',
      userId: 'user-1',
      issuedAt: '2026-04-06T10:00:00.000Z',
      expiresAt: '2026-04-06T12:00:00.000Z',
      provider: 'password',
    },
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2026-04-06T11:00:00.000Z',
    },
  }
}

describe('auth session storage', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  it('saves and retrieves auth session state from app settings', async () => {
    const authState = buildAuthState()

    await saveAuthSessionState(authState)

    const loaded = await getAuthSessionState()
    expect(loaded).toEqual(authState)
  })

  it('clears auth session state', async () => {
    await saveAuthSessionState(buildAuthState())
    await clearAuthSessionState()

    const loaded = await getAuthSessionState()
    expect(loaded).toBeNull()
  })

  it('returns null when auth session state is invalid json', async () => {
    await nexpillDb.appSettings.put({
      key: 'authSessionState',
      value: '{ invalid json',
    })

    const loaded = await getAuthSessionState()
    expect(loaded).toBeNull()
  })

  it('evaluates session expiry deterministically', () => {
    const authState = buildAuthState()

    expect(hasValidSessionExpiry(authState, new Date('2026-04-06T11:59:59.000Z'))).toBe(true)
    expect(hasValidSessionExpiry(authState, new Date('2026-04-06T12:00:00.000Z'))).toBe(false)
  })

})
