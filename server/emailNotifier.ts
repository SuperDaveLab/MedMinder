import type { ReminderNotificationCandidate } from '../src/reminders/notifications'
import { serverConfig } from './config'

export interface NotificationEmailPayload {
  to: string
  candidate: ReminderNotificationCandidate
}

function buildPlainTextBody(candidate: ReminderNotificationCandidate): string {
  return [
    candidate.title,
    '',
    candidate.body,
    '',
    '-- Med-Minder',
  ].join('\n')
}

/**
 * Send a reminder notification email for a single medication event.
 *
 * STUB: Currently logs to stdout only. To enable real delivery, install a
 * mailer library (e.g. nodemailer) and replace the log below with an SMTP
 * send using the serverConfig.smtp settings. Required .env keys:
 *
 *   SMTP_HOST       — SMTP server hostname (e.g. smtp.mailersend.net)
 *   SMTP_PORT       — SMTP port, default 587 (STARTTLS)
 *   SMTP_USER       — SMTP username / API key
 *   SMTP_PASSWORD   — SMTP password / API secret
 *   SMTP_FROM       — From address (e.g. "Med-Minder <noreply@example.com>")
 */
export async function sendNotificationEmail(
  payload: NotificationEmailPayload,
): Promise<boolean> {
  if (!serverConfig.smtp.host) {
    // SMTP not configured — log only so the scheduler still runs in dev.
    console.log(
      `[notification-stub] ${payload.to} | ${payload.candidate.title} | ${payload.candidate.body}`,
    )
    return false
  }

  // TODO: replace with real SMTP send once nodemailer (or similar) is installed.
  // Example with nodemailer:
  //
  //   const transporter = nodemailer.createTransport({
  //     host: serverConfig.smtp.host,
  //     port: serverConfig.smtp.port,
  //     auth: { user: serverConfig.smtp.user, pass: serverConfig.smtp.password },
  //   })
  //
  //   await transporter.sendMail({
  //     from: serverConfig.smtp.from,
  //     to: payload.to,
  //     subject: payload.candidate.title,
  //     text: buildPlainTextBody(payload.candidate),
  //   })

  console.log(
    `[notification-stub] SMTP configured but sending not yet implemented. ` +
    `Would send to ${payload.to}: "${payload.candidate.title}"`,
  )

  void buildPlainTextBody // keep linter happy until the TODO above is filled in
  return false
}
