import type { AuthSessionState } from '../domain/auth'
import type { CloudSyncRequest, CloudSyncResponse } from '../domain/cloudSync'
import type { MedMinderState } from '../domain/types'

export interface CloudSyncApiClient {
  sync: (authState: AuthSessionState, request: CloudSyncRequest) => Promise<CloudSyncResponse>
  getState: (authState: AuthSessionState) => Promise<MedMinderState>
}

interface JsonErrorPayload {
  message?: string
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function handleError(response: Response): Promise<never> {
  let message = `Request failed (${String(response.status)})`

  try {
    const payload = await parseJson<JsonErrorPayload>(response)
    if (payload?.message) {
      message = payload.message
    }
  } catch {
    // no-op
  }

  throw new Error(message)
}

export function createCloudSyncApiClient(baseUrl: string): CloudSyncApiClient {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')

  return {
    sync: async (authState, request) => {
      const response = await fetch(`${normalizedBaseUrl}/api/cloud/sync`, {
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

      return parseJson<CloudSyncResponse>(response)
    },
    getState: async (authState) => {
      const response = await fetch(`${normalizedBaseUrl}/api/cloud/state`, {
        method: 'GET',
        headers: {
          'x-medminder-session-id': authState.session.sessionId,
        },
      })

      if (!response.ok) {
        await handleError(response)
      }

      return parseJson<MedMinderState>(response)
    },
  }
}
