import type { AuthSessionState } from '../domain/auth'
import { medMinderDb } from './database'

const AUTH_SESSION_STATE_KEY = 'authSessionState'

export async function getAuthSessionState(): Promise<AuthSessionState | null> {
  const record = await medMinderDb.appSettings.get(AUTH_SESSION_STATE_KEY)

  if (!record?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(record.value) as AuthSessionState

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export async function saveAuthSessionState(state: AuthSessionState): Promise<void> {
  await medMinderDb.appSettings.put({
    key: AUTH_SESSION_STATE_KEY,
    value: JSON.stringify(state),
  })
}

export async function clearAuthSessionState(): Promise<void> {
  await medMinderDb.appSettings.delete(AUTH_SESSION_STATE_KEY)
}
