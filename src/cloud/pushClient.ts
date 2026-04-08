import type { AuthSessionState } from '../domain/auth'
import type {
  DeletePushSubscriptionRequest,
  PushPublicKeyResponse,
  RegisterPushSubscriptionRequest,
} from '../domain/pushNotifications'
import { getJsonErrorMessage, parseJsonResponse } from './http'

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

async function handleError(response: Response): Promise<never> {
  const message = await getJsonErrorMessage(response)
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

      return parseJsonResponse<PushPublicKeyResponse>(response)
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
