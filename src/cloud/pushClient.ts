import type { AuthSessionState } from '../domain/auth'
import type {
  DeletePushSubscriptionRequest,
  PushPublicKeyResponse,
  RegisterPushSubscriptionRequest,
} from '../domain/pushNotifications'

export interface PushApiClient {
  getPublicKey: () => Promise<PushPublicKeyResponse>
  upsertSubscription: (
    authState: AuthSessionState,
    request: RegisterPushSubscriptionRequest,
  ) => Promise<void>
  deleteSubscription: (
    authState: AuthSessionState,
    request: DeletePushSubscriptionRequest,
  ) => Promise<void>
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

export function createPushApiClient(baseUrl: string): PushApiClient {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  return {
    getPublicKey: async () => {
      const response = await fetch(`${normalizedBaseUrl}/api/notifications/push/public-key`)

      if (!response.ok) {
        await handleError(response)
      }

      return parseJson<PushPublicKeyResponse>(response)
    },

    upsertSubscription: async (authState, request) => {
      const response = await fetch(`${normalizedBaseUrl}/api/notifications/push/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-medminder-session-id': authState.session.sessionId,
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await handleError(response)
      }
    },

    deleteSubscription: async (authState, request) => {
      const response = await fetch(`${normalizedBaseUrl}/api/notifications/push/subscriptions`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-medminder-session-id': authState.session.sessionId,
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await handleError(response)
      }
    },
  }
}
