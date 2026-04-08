import type { AuthSessionState } from '../domain/auth'
import type { CloudSyncRequest, CloudSyncResponse } from '../domain/cloudSync'
import type { MedMinderState } from '../domain/types'
import { getJsonErrorMessage, parseJsonResponse } from './http'

export interface CloudSyncApiClient {
  sync: (authState: AuthSessionState, request: CloudSyncRequest) => Promise<CloudSyncResponse>
  getState: (authState: AuthSessionState) => Promise<MedMinderState>
}

async function handleError(response: Response): Promise<never> {
  const message = await getJsonErrorMessage(response)
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

      return parseJsonResponse<CloudSyncResponse>(response)
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

      return parseJsonResponse<MedMinderState>(response)
    },
  }
}
