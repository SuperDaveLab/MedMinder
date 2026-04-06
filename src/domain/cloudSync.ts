import type { DoseEvent, ISODateString, MedMinderState, Medication, Patient } from './types'

export const cloudEntityTypes = ['patient', 'medication', 'dose_event'] as const
export type CloudEntityType = (typeof cloudEntityTypes)[number]

export interface AccountIdentity {
  accountId: string
  userId: string
  email: string
  createdAt: ISODateString
}

export interface AccountSession {
  sessionId: string
  accountId: string
  userId: string
  issuedAt: ISODateString
  expiresAt: ISODateString
}

export interface DeviceIdentity {
  deviceId: string
  platform: 'pwa'
  appVersion?: string
  timezone?: string
}

export interface CloudRecordMetadata {
  accountId: string
  recordVersion: number
  createdAt: ISODateString
  updatedAt: ISODateString
  deletedAt: ISODateString | null
}

export interface CloudPatientRecord {
  entityType: 'patient'
  recordId: string
  payload: Patient
  meta: CloudRecordMetadata
}

export interface CloudMedicationRecord {
  entityType: 'medication'
  recordId: string
  payload: Medication
  meta: CloudRecordMetadata
}

export interface CloudDoseEventRecord {
  entityType: 'dose_event'
  recordId: string
  payload: DoseEvent
  meta: CloudRecordMetadata
}

export type CloudRecord =
  | CloudPatientRecord
  | CloudMedicationRecord
  | CloudDoseEventRecord

export interface CloudUpsertMutation {
  kind: 'upsert'
  entityType: CloudEntityType
  recordId: string
  payload: Patient | Medication | DoseEvent
  baseVersion: number | null
  changedAt: ISODateString
}

export interface CloudDeleteMutation {
  kind: 'delete'
  entityType: CloudEntityType
  recordId: string
  baseVersion: number | null
  changedAt: ISODateString
}

export type CloudMutation = CloudUpsertMutation | CloudDeleteMutation

export interface CloudSyncCursor {
  serverVersion: number
  generatedAt: ISODateString
}

export interface CloudSyncRequest {
  schemaVersion: 1
  mode: 'bootstrap' | 'incremental'
  accountId: string
  device: DeviceIdentity
  sentAt: ISODateString
  cursor: CloudSyncCursor | null
  mutations: CloudMutation[]
}

export interface CloudSyncMutationResult {
  mutationId: number
  outcome: 'accepted' | 'conflict' | 'rejected'
  recordId: string
  entityType: CloudEntityType
  serverVersion?: number
  reason?: string
}

export interface CloudSyncResponse {
  schemaVersion: 1
  accountId: string
  receivedAt: ISODateString
  nextCursor: CloudSyncCursor
  mutationResults: CloudSyncMutationResult[]
  remoteChanges: CloudMutation[]
}

export interface BuildBootstrapSyncRequestOptions {
  accountId: string
  now: Date
  device: DeviceIdentity
}

export function buildBootstrapSyncRequest(
  state: MedMinderState,
  options: BuildBootstrapSyncRequestOptions,
): CloudSyncRequest {
  const changedAt = options.now.toISOString()

  const patientMutations: CloudUpsertMutation[] = state.patients.map((patient) => ({
    kind: 'upsert',
    entityType: 'patient',
    recordId: patient.id,
    payload: patient,
    baseVersion: null,
    changedAt,
  }))

  const medicationMutations: CloudUpsertMutation[] = state.medications.map((medication) => ({
    kind: 'upsert',
    entityType: 'medication',
    recordId: medication.id,
    payload: medication,
    baseVersion: null,
    changedAt,
  }))

  const doseEventMutations: CloudUpsertMutation[] = state.doseEvents.map((doseEvent) => ({
    kind: 'upsert',
    entityType: 'dose_event',
    recordId: doseEvent.id,
    payload: doseEvent,
    baseVersion: null,
    changedAt,
  }))

  return {
    schemaVersion: 1,
    mode: 'bootstrap',
    accountId: options.accountId,
    device: options.device,
    sentAt: changedAt,
    cursor: null,
    mutations: [
      ...patientMutations,
      ...medicationMutations,
      ...doseEventMutations,
    ],
  }
}