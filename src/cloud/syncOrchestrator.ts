import type { AuthSessionState } from '../domain/auth'
import { buildBootstrapSyncRequest } from '../domain/cloudSync'
import type { MedMinderState } from '../domain/types'
import { clearLocalClinicalData, getLocalMedMinderState } from '../storage/repository'
import { createCloudSyncApiClient } from './syncClient'

function getApiBaseUrl(): string {
  return String(import.meta.env.VITE_API_BASE_URL ?? '')
}

function buildDeviceIdentity() {
  return {
    deviceId: 'local-pwa-device',
    platform: 'pwa' as const,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function buildBootstrapRequest(authState: AuthSessionState, state: MedMinderState) {
  return buildBootstrapSyncRequest(state, {
    accountId: authState.account.accountId,
    now: new Date(),
    device: buildDeviceIdentity(),
  })
}

export async function bootstrapCloudFromLocal(authState: AuthSessionState): Promise<void> {
  const client = createCloudSyncApiClient(getApiBaseUrl())
  const localState = await getLocalMedMinderState()

  await client.sync(authState, buildBootstrapRequest(authState, localState))
  await clearLocalClinicalData()
}

export async function startCloudSession(authState: AuthSessionState): Promise<void> {
  const client = createCloudSyncApiClient(getApiBaseUrl())
  await client.getState(authState)
  await clearLocalClinicalData()
}

export async function fetchCloudState(authState: AuthSessionState): Promise<MedMinderState> {
  const client = createCloudSyncApiClient(getApiBaseUrl())
  return client.getState(authState)
}

// Write strategy: cloud writes currently use full-state replacement via a
// bootstrap-mode sync request. Every mutation (patient, medication, dose)
// sends the complete in-memory state as a fresh set of upsert mutations with
// baseVersion: null. This keeps the client simple and avoids conflict
// resolution logic. The trade-off is larger sync payloads and no incremental
// merge. When the dataset grows, replace this with an incremental mutation
// queue that sends only changed records with their recorded baseVersion.
export async function replaceCloudState(
  authState: AuthSessionState,
  state: MedMinderState,
): Promise<void> {
  const client = createCloudSyncApiClient(getApiBaseUrl())
  await client.sync(authState, buildBootstrapRequest(authState, state))
}
