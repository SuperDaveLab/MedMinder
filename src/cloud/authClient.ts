import type {
  AuthAccount,
  CreateAccountRequest,
  CreateAccountResponse,
  SignInWithPasswordRequest,
  SignInWithPasswordResponse,
  SignOutRequest,
  UpdateAccountProfileRequest,
} from '../domain/auth'

export interface AuthApiClient {
  createAccount: (request: CreateAccountRequest) => Promise<CreateAccountResponse>
  signInWithPassword: (request: SignInWithPasswordRequest) => Promise<SignInWithPasswordResponse>
  signOut: (request: SignOutRequest) => Promise<void>
  getAccountProfile: (sessionId: string) => Promise<AuthAccount>
  updateAccountProfile: (sessionId: string, request: UpdateAccountProfileRequest) => Promise<AuthAccount>
}

interface JsonErrorPayload {
  message?: string
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T
  return payload
}

async function handleError(response: Response): Promise<never> {
  let message = `Request failed (${String(response.status)})`

  try {
    const payload = await parseJson<JsonErrorPayload>(response)
    if (payload?.message) {
      message = payload.message
    }
  } catch {
    // ignore parse failures and fall back to generic status text
  }

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
        ...(sessionId ? { 'x-medminder-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      await handleError(response)
    }

    if (response.status === 204) {
      return undefined as TResponse
    }

    return parseJson<TResponse>(response)
  }

  return {
    createAccount: (request) => postJson<CreateAccountRequest, CreateAccountResponse>('/api/auth/register', request),
    signInWithPassword: (request) => postJson<SignInWithPasswordRequest, SignInWithPasswordResponse>('/api/auth/login', request),
    signOut: async (request) => {
      await postJson<SignOutRequest, void>('/api/auth/logout', request)
    },
    getAccountProfile: async (sessionId) => {
      const response = await fetch(`${normalizedBaseUrl}/api/auth/account`, {
        method: 'GET',
        headers: {
          'x-medminder-session-id': sessionId,
        },
      })

      if (!response.ok) {
        await handleError(response)
      }

      return parseJson<AuthAccount>(response)
    },
    updateAccountProfile: async (sessionId, request) => {
      const response = await fetch(`${normalizedBaseUrl}/api/auth/account`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-medminder-session-id': sessionId,
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await handleError(response)
      }

      return parseJson<AuthAccount>(response)
    },
  }
}
