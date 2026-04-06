import type { WebPushSubscriptionPayload } from '../src/domain/pushNotifications'
import { dbPool } from './db'

function parseSubscriptionPayload(value: string): WebPushSubscriptionPayload {
  return JSON.parse(value) as WebPushSubscriptionPayload
}

export async function upsertPushSubscription(
  accountId: string,
  subscription: WebPushSubscriptionPayload,
): Promise<void> {
  const now = new Date()

  await dbPool.query(
    `
      INSERT INTO push_subscriptions (
        account_id,
        endpoint,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        updated_at = VALUES(updated_at)
    `,
    [accountId, subscription.endpoint, JSON.stringify(subscription), now, now],
  )
}

export async function deletePushSubscription(
  accountId: string,
  endpoint: string,
): Promise<void> {
  await dbPool.query(
    'DELETE FROM push_subscriptions WHERE account_id = ? AND endpoint = ?',
    [accountId, endpoint],
  )
}

export async function listPushSubscriptions(
  accountId: string,
): Promise<WebPushSubscriptionPayload[]> {
  const [rows] = await dbPool.query<Array<{ payload_json: string }>>(
    'SELECT payload_json FROM push_subscriptions WHERE account_id = ?',
    [accountId],
  )

  return rows.map((row) => parseSubscriptionPayload(row.payload_json))
}
