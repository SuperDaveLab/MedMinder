import type {
  CloudMutation,
  CloudSyncMutationResult,
  CloudSyncRequest,
  CloudSyncResponse,
} from '../src/domain/cloudSync'
import type { RowDataPacket } from 'mysql2/promise'
import type { DoseEvent, Medication, Patient } from '../src/domain/types'
import { dbPool } from './db'

export interface AuthenticatedAccountContext {
  accountId: string
  userId: string
  sessionId: string
}

export interface CloudAccountState {
  patients: Patient[]
  medications: Medication[]
  doseEvents: DoseEvent[]
}

interface MedicationIdRow extends RowDataPacket {
  medication_id: string
}

interface PayloadRow extends RowDataPacket {
  payload_json: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseJsonPayload<T>(value: string): T {
  return JSON.parse(value) as T
}

async function replaceAccountState(
  accountId: string,
  mutations: CloudMutation[],
): Promise<void> {
  await dbPool.query('DELETE FROM cloud_dose_events WHERE account_id = ?', [accountId])
  await dbPool.query('DELETE FROM cloud_medications WHERE account_id = ?', [accountId])
  await dbPool.query('DELETE FROM cloud_patients WHERE account_id = ?', [accountId])

  const upserts = mutations.filter((mutation) => mutation.kind === 'upsert')
  const updatedAt = new Date()

  for (const mutation of upserts) {
    const payloadJson = JSON.stringify(mutation.payload)

    if (mutation.entityType === 'patient') {
      await dbPool.query(
        `
          INSERT INTO cloud_patients (account_id, patient_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        [accountId, mutation.recordId, payloadJson, updatedAt],
      )
      continue
    }

    if (mutation.entityType === 'medication') {
      await dbPool.query(
        `
          INSERT INTO cloud_medications (account_id, medication_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        [accountId, mutation.recordId, payloadJson, updatedAt],
      )
      continue
    }

    await dbPool.query(
      `
        INSERT INTO cloud_dose_events (account_id, dose_event_id, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      [accountId, mutation.recordId, payloadJson, updatedAt],
    )
  }
}

async function applyMutation(accountId: string, mutation: CloudMutation): Promise<void> {
  const updatedAt = new Date()

  if (mutation.kind === 'delete') {
    if (mutation.entityType === 'patient') {
      const [medicationRows] = await dbPool.query<MedicationIdRow[]>(
        `
          SELECT medication_id
          FROM cloud_medications
          WHERE account_id = ?
            AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.patientId')) = ?
        `,
        [accountId, mutation.recordId],
      )

      if (medicationRows.length > 0) {
        const medicationIds = medicationRows.map((row) => row.medication_id)
        const placeholders = medicationIds.map(() => '?').join(', ')

        await dbPool.query(
          `DELETE FROM cloud_dose_events WHERE account_id = ? AND medication_id IN (${placeholders})`,
          [accountId, ...medicationIds],
        )
        await dbPool.query(
          `DELETE FROM cloud_medications WHERE account_id = ? AND medication_id IN (${placeholders})`,
          [accountId, ...medicationIds],
        )
      }

      await dbPool.query(
        'DELETE FROM cloud_patients WHERE account_id = ? AND patient_id = ?',
        [accountId, mutation.recordId],
      )
      return
    }

    if (mutation.entityType === 'medication') {
      await dbPool.query(
        'DELETE FROM cloud_dose_events WHERE account_id = ? AND medication_id = ?',
        [accountId, mutation.recordId],
      )
      await dbPool.query(
        'DELETE FROM cloud_medications WHERE account_id = ? AND medication_id = ?',
        [accountId, mutation.recordId],
      )
      return
    }

    await dbPool.query(
      'DELETE FROM cloud_dose_events WHERE account_id = ? AND dose_event_id = ?',
      [accountId, mutation.recordId],
    )
    return
  }

  const payloadJson = JSON.stringify(mutation.payload)

  if (mutation.entityType === 'patient') {
    await dbPool.query(
      `
        INSERT INTO cloud_patients (account_id, patient_id, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload_json = VALUES(payload_json),
          updated_at = VALUES(updated_at)
      `,
      [accountId, mutation.recordId, payloadJson, updatedAt],
    )
    return
  }

  if (mutation.entityType === 'medication') {
    await dbPool.query(
      `
        INSERT INTO cloud_medications (account_id, medication_id, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload_json = VALUES(payload_json),
          updated_at = VALUES(updated_at)
      `,
      [accountId, mutation.recordId, payloadJson, updatedAt],
    )
    return
  }

  await dbPool.query(
    `
      INSERT INTO cloud_dose_events (account_id, dose_event_id, payload_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        updated_at = VALUES(updated_at)
    `,
    [accountId, mutation.recordId, payloadJson, updatedAt],
  )
}

export async function applyCloudSyncRequest(
  account: AuthenticatedAccountContext,
  request: CloudSyncRequest,
): Promise<CloudSyncResponse> {
  if (request.accountId !== account.accountId) {
    throw new Error('Sync account mismatch.')
  }

  if (request.mode === 'bootstrap') {
    await replaceAccountState(account.accountId, request.mutations)
  } else {
    for (const mutation of request.mutations) {
      await applyMutation(account.accountId, mutation)
    }
  }

  const mutationResults: CloudSyncMutationResult[] = request.mutations.map((mutation, index) => ({
    mutationId: index,
    outcome: 'accepted',
    recordId: mutation.recordId,
    entityType: mutation.entityType,
    serverVersion: Date.now(),
  }))

  return {
    schemaVersion: 1,
    accountId: account.accountId,
    receivedAt: nowIso(),
    nextCursor: {
      serverVersion: Date.now(),
      generatedAt: nowIso(),
    },
    mutationResults,
    remoteChanges: [],
  }
}

export async function getCloudAccountState(accountId: string): Promise<CloudAccountState> {
  const [patientRows] = await dbPool.query<PayloadRow[]>(
    'SELECT payload_json FROM cloud_patients WHERE account_id = ?',
    [accountId],
  )

  const [medicationRows] = await dbPool.query<PayloadRow[]>(
    'SELECT payload_json FROM cloud_medications WHERE account_id = ?',
    [accountId],
  )

  const [doseEventRows] = await dbPool.query<PayloadRow[]>(
    'SELECT payload_json FROM cloud_dose_events WHERE account_id = ?',
    [accountId],
  )

  return {
    patients: patientRows.map((row) => parseJsonPayload<Patient>(row.payload_json)),
    medications: medicationRows.map((row) => parseJsonPayload<Medication>(row.payload_json)),
    doseEvents: doseEventRows.map((row) => parseJsonPayload<DoseEvent>(row.payload_json)),
  }
}
