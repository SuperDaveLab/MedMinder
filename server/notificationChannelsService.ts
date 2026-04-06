import { dbPool } from './db'

export interface AccountNotificationChannels {
  email: string | null
  smsPhoneE164: string | null
}

export async function getAccountNotificationChannels(
  accountId: string,
): Promise<AccountNotificationChannels> {
  const [userRows] = await dbPool.query<Array<{ email: string; phone_e164: string | null }>>(
    'SELECT email, phone_e164 FROM users WHERE account_id = ? LIMIT 1',
    [accountId],
  )

  const [channelRows] = await dbPool.query<Array<{ sms_phone_e164: string | null }>>(
    'SELECT sms_phone_e164 FROM notification_channels WHERE account_id = ? LIMIT 1',
    [accountId],
  )

  return {
    email: userRows[0]?.email ?? null,
    smsPhoneE164: userRows[0]?.phone_e164 ?? channelRows[0]?.sms_phone_e164 ?? null,
  }
}

export async function upsertSmsPhone(
  accountId: string,
  smsPhoneE164: string | null,
): Promise<void> {
  await dbPool.query(
    `
      UPDATE users
      SET phone_e164 = ?
      WHERE account_id = ?
    `,
    [smsPhoneE164, accountId],
  )

  await dbPool.query(
    `
      INSERT INTO notification_channels (account_id, sms_phone_e164, updated_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        sms_phone_e164 = VALUES(sms_phone_e164),
        updated_at = VALUES(updated_at)
    `,
    [accountId, smsPhoneE164, new Date()],
  )
}
