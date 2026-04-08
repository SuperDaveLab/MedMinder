import dotenv from 'dotenv'

dotenv.config()

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) ? parsed : fallback
}

export const serverConfig = {
  port: parseNumber(process.env.AUTH_API_PORT, 8787),
  publicAppUrl: process.env.AUTH_PUBLIC_APP_URL ?? process.env.PUBLIC_APP_URL ?? '',
  db: {
    host: process.env.AUTH_DB_HOST ?? '127.0.0.1',
    port: parseNumber(process.env.AUTH_DB_PORT, 3306),
    user: process.env.AUTH_DB_USER ?? 'medminder_app',
    password: process.env.AUTH_DB_PASSWORD ?? '',
    database: process.env.AUTH_DB_NAME ?? 'medminder_auth',
  },
  accessTokenTtlMinutes: parseNumber(process.env.AUTH_ACCESS_TOKEN_TTL_MINUTES, 30),
  sessionTtlDays: parseNumber(process.env.AUTH_SESSION_TTL_DAYS, 30),
  passwordResetTokenTtlMinutes: parseNumber(process.env.AUTH_PASSWORD_RESET_TTL_MINUTES, 60),
  // SMTP settings for email notification delivery.
  // Required env vars: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER,
  // SMTP_PASSWORD, SMTP_FROM (e.g. "Med-Minder <noreply@example.com>").
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseNumber(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
  },
  push: {
    vapidPublicKey: process.env.PUSH_VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: process.env.PUSH_VAPID_PRIVATE_KEY ?? '',
    vapidSubject: process.env.PUSH_VAPID_SUBJECT ?? 'mailto:noreply@example.com',
  },
  notificationSchedulerIntervalMs: parseNumber(
    process.env.NOTIFICATION_SCHEDULER_INTERVAL_MS,
    5 * 60 * 1000,
  ),
}
