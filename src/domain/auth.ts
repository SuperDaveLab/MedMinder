import type { ISODateString } from './types'
import type { NotificationDeliveryPolicy } from './notificationPolicy'

export const authProviders = ['password', 'magic_link', 'oauth_google'] as const
export type AuthProvider = (typeof authProviders)[number]

export interface AuthAccount {
  accountId: string
  userId: string
  email: string
  phoneE164?: string
  notificationDeliveryPolicy: NotificationDeliveryPolicy
  createdAt: ISODateString
}

export interface AuthTokenSet {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: ISODateString
}

export interface AuthSession {
  sessionId: string
  accountId: string
  userId: string
  issuedAt: ISODateString
  expiresAt: ISODateString
  provider: AuthProvider
}

export interface AuthSessionState {
  account: AuthAccount
  session: AuthSession
  tokens: AuthTokenSet
}

export interface SignInWithPasswordRequest {
  email: string
  password: string
  timezone?: string
}

export interface CreateAccountRequest {
  email: string
  password: string
  timezone?: string
}

export interface CreateAccountResponse {
  account: AuthAccount
  session: AuthSession
  tokens: AuthTokenSet
}

export interface SignInWithPasswordResponse {
  account: AuthAccount
  session: AuthSession
  tokens: AuthTokenSet
}

export interface RefreshSessionRequest {
  refreshToken: string
}

export interface RefreshSessionResponse {
  session: AuthSession
  tokens: AuthTokenSet
}

export interface SignOutRequest {
  sessionId: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface ChangePasswordResponse {
  success: true
}

export interface UpdateAccountProfileRequest {
  phoneE164?: string | null
  notificationDeliveryPolicy?: NotificationDeliveryPolicy
}

export function hasValidSessionExpiry(state: AuthSessionState, now: Date): boolean {
  const expiresAt = Date.parse(state.session.expiresAt)

  if (Number.isNaN(expiresAt) || Number.isNaN(now.getTime())) {
    return false
  }

  return expiresAt > now.getTime()
}
