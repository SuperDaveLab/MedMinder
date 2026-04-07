import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
} from '../src/reminders/notifications'
import { serverConfig } from './config'
import { dbPool } from './db'
import { sendNotificationEmail } from './emailNotifier'
import { getCloudAccountState } from './cloudService'
import { sendPushReminderNotification } from './pushNotifier'
import { getAccountNotificationChannels } from './notificationChannelsService'
import { sendNotificationSms } from './smsNotifier'
import {
  shouldAttemptEmail,
  shouldAttemptPush,
} from '../src/domain/notificationPolicy'

// How long to keep notification log entries before pruning them.
const LOG_RETENTION_DAYS = 30

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getAccountIdsWithActiveMedications(): Promise<string[]> {
  // JSON_EXTRACT lets us filter without needing a separate column.
  const [rows] = await dbPool.query<Array<{ account_id: string }>>(
    `SELECT DISTINCT account_id
     FROM cloud_medications
     WHERE JSON_EXTRACT(payload_json, '$.active') = TRUE`,
  )

  return rows.map((row) => row.account_id)
}

async function getNotificationLog(accountId: string): Promise<Record<string, string>> {
  const [rows] = await dbPool.query<Array<{ dedupe_key: string; sent_at: Date }>>(
    'SELECT dedupe_key, sent_at FROM notification_log WHERE account_id = ?',
    [accountId],
  )

  return Object.fromEntries(
    rows.map((row) => [row.dedupe_key, row.sent_at.toISOString()]),
  )
}

async function recordNotificationSent(accountId: string, dedupeKey: string): Promise<void> {
  await dbPool.query(
    `INSERT INTO notification_log (account_id, dedupe_key, sent_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE sent_at = VALUES(sent_at)`,
    [accountId, dedupeKey, new Date()],
  )
}

async function pruneNotificationLog(): Promise<void> {
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  await dbPool.query(
    'DELETE FROM notification_log WHERE sent_at < ?',
    [cutoff],
  )
}

// ---------------------------------------------------------------------------
// Per-account check
// ---------------------------------------------------------------------------

async function checkAccountNotifications(accountId: string, now: Date): Promise<void> {
  const [state, channels] = await Promise.all([
    getCloudAccountState(accountId),
    getAccountNotificationChannels(accountId),
  ])

  const sentLog = await getNotificationLog(accountId)
  const candidates = buildReminderNotificationCandidates(state.medications, state.doseEvents, now)
  const unsent = filterUnsentReminderCandidates(candidates, sentLog)
  const patientNameById = Object.fromEntries(
    state.patients.map((patient) => [patient.id, patient.displayName]),
  )

  for (const candidate of unsent) {
    try {
      let delivered = false
      let pushDelivered = false

      if (shouldAttemptPush(channels.notificationDeliveryPolicy)) {
        const pushResult = await sendPushReminderNotification(accountId, candidate)
        if (pushResult.delivered > 0) {
          delivered = true
          pushDelivered = true
        }
      }

      if (channels.email && shouldAttemptEmail(channels.notificationDeliveryPolicy, pushDelivered)) {
        const emailDelivered = await sendNotificationEmail({
          to: channels.email,
          candidate,
          patientName: patientNameById[candidate.patientId],
        })
        if (emailDelivered) {
          delivered = true
        }
      }

      if (channels.smsPhoneE164) {
        const smsDelivered = await sendNotificationSms(channels.smsPhoneE164, candidate)
        if (smsDelivered) {
          delivered = true
        }
      }

      if (delivered) {
        await recordNotificationSent(accountId, candidate.dedupeKey)
      } else {
        console.warn(
          `[scheduler] No notification channel delivered for account ${accountId} and dedupe key ${candidate.dedupeKey}`,
        )
      }
    } catch (error) {
      console.error(
        `[scheduler] Failed to send notification for account ${accountId}:`,
        error,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

async function runNotificationCheck(): Promise<void> {
  const now = new Date()

  let accountIds: string[]
  try {
    accountIds = await getAccountIdsWithActiveMedications()
  } catch (error) {
    console.error('[scheduler] Failed to fetch accounts for notification check:', error)
    return
  }

  for (const accountId of accountIds) {
    try {
      await checkAccountNotifications(accountId, now)
    } catch (error) {
      console.error(`[scheduler] Error checking notifications for account ${accountId}:`, error)
    }
  }

  try {
    await pruneNotificationLog()
  } catch (error) {
    console.error('[scheduler] Failed to prune notification log:', error)
  }
}

export function startNotificationScheduler(): void {
  const intervalMs = serverConfig.notificationSchedulerIntervalMs

  console.log(
    `[scheduler] Notification scheduler started (interval: ${String(intervalMs / 1000)}s).`,
  )

  // Run immediately on boot, then on each interval.
  void runNotificationCheck()

  setInterval(() => {
    void runNotificationCheck()
  }, intervalMs)
}
