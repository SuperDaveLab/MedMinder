import type {
  AccountSessionSummary,
  AuthAccount,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreateAccountRequest,
  CreateAccountResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  RevokeOtherSessionsResponse,
  SignInWithPasswordRequest,
  SignInWithPasswordResponse,
  SignOutRequest,
  ListAccountSessionsResponse,
  UpdateAccountProfileRequest,
} from '../domain/auth'
import { getJsonErrorMessage, parseJsonResponse } from './http'

export interface AuthApiClient {
  createAccount: (request: CreateAccountRequest) => Promise<CreateAccountResponse>
  signInWithPassword: (request: SignInWithPasswordRequest) => Promise<SignInWithPasswordResponse>
  signOut: (request: SignOutRequest) => Promise<void>
  changePassword: (sessionId: string, request: ChangePasswordRequest) => Promise<ChangePasswordResponse>
  requestPasswordReset: (request: ForgotPasswordRequest) => Promise<ForgotPasswordResponse>
  resetPassword: (request: ResetPasswordRequest) => Promise<ResetPasswordResponse>
  getAccountProfile: (sessionId: string) => Promise<AuthAccount>
  updateAccountProfile: (sessionId: string, request: UpdateAccountProfileRequest) => Promise<AuthAccount>
  listAccountSessions: (sessionId: string) => Promise<AccountSessionSummary[]>
  revokeOtherSessions: (sessionId: string) => Promise<RevokeOtherSessionsResponse>
  emailExport: (sessionId: string, payload: { filename: string; content: string; mimeType: string }) => Promise<{ sent: boolean }>
}

async function handleError(response: Response): Promise<never> {
  const message = await getJsonErrorMessage(response)
  throw new Error(message)
}

export function createAuthApiClient(baseUrl: string): AuthApiClient {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  async function postJson<TRequest, TResponse>(
    path: string,
    body: TRequest,
    sessionId?: string,
  ): Promise<TResponse> {
    const response = await fetch(`${normalizedBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-nexpill-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      await handleError(response)
    }

    if (response.status === 204) {
      return undefined as TResponse
    }

    return parseJsonResponse<TResponse>(response)
  }

  return {
    createAccount: (request) => postJson<CreateAccountRequest, CreateAccountResponse>('/api/auth/register', request),
    signInWithPassword: (request) => postJson<SignInWithPasswordRequest, SignInWithPasswordResponse>('/api/auth/login', request),
    signOut: async (request) => {
      await postJson<SignOutRequest, void>('/api/auth/logout', request)
    },
    changePassword: (sessionId, request) => postJson<ChangePasswordRequest, ChangePasswordResponse>(
      '/api/auth/change-password',
      request,
      sessionId,
    ),
    requestPasswordReset: (request) => postJson<ForgotPasswordRequest, ForgotPasswordResponse>(
      '/api/auth/forgot-password',
      request,
    ),
    resetPassword: (request) => postJson<ResetPasswordRequest, ResetPasswordResponse>(
      '/api/auth/reset-password',
      request,
    ),
    getAccountProfile: async (sessionId) => {
      const response = await fetch(`${normalizedBaseUrl}/api/auth/account`, {
        method: 'GET',
        headers: {
          'x-nexpill-session-id': sessionId,
        },
      })

      if (!response.ok) {
        await handleError(response)
      }

      return parseJsonResponse<AuthAccount>(response)
    },
    updateAccountProfile: async (sessionId, request) => {
      const response = await fetch(`${normalizedBaseUrl}/api/auth/account`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-nexpill-session-id': sessionId,
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await handleError(response)
      }

      return parseJsonResponse<AuthAccount>(response)
    },
    listAccountSessions: async (sessionId) => {
      const response = await fetch(`${normalizedBaseUrl}/api/auth/sessions`, {
        method: 'GET',
        headers: {
          'x-nexpill-session-id': sessionId,
        },
      })

      if (!response.ok) {
        await handleError(response)
      }

      const payload = await parseJsonResponse<ListAccountSessionsResponse>(response)
      return payload.sessions
    },
    revokeOtherSessions: (sessionId) => postJson<Record<string, never>, RevokeOtherSessionsResponse>(
      '/api/auth/sessions/revoke-others',
      {},
      sessionId,
    ),
    emailExport: (sessionId, payload) => postJson<{ filename: string; content: string; mimeType: string }, { sent: boolean }>(
      '/api/export/email',
      payload,
      sessionId,
    ),
  }
}
