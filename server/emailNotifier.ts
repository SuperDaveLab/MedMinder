import type { ReminderNotificationCandidate } from '../src/reminders/notifications'
import nodemailer from 'nodemailer'
import { serverConfig } from './config'

export interface NotificationEmailPayload {
  to: string
  candidate: ReminderNotificationCandidate
  patientName?: string
}

export interface TransactionalEmailPayload {
  to: string
  subject: string
  text: string
}

function formatCandidateKind(kind: ReminderNotificationCandidate['kind']): string {
  if (kind === 'due-now') {
    return 'Due now'
  }

  if (kind === 'due-soon') {
    return 'Due soon'
  }

  return 'Overdue'
}

function buildEmailSubject(payload: NotificationEmailPayload): string {
  if (payload.patientName) {
    return `Med-Minder: ${payload.patientName} - ${payload.candidate.medicationName}`
  }

  return `Med-Minder: ${payload.candidate.medicationName}`
}

function buildPlainTextBody(payload: NotificationEmailPayload): string {
  const { candidate, patientName } = payload

  return [
    'Med-Minder reminder',
    '',
    `Patient: ${patientName ?? 'Unspecified'}`,
    `Medication: ${candidate.medicationName}`,
    `Status: ${formatCandidateKind(candidate.kind)}`,
    `Next eligible: ${candidate.nextEligibleAtIso}`,
    '',
    candidate.title,
    candidate.body,
    '',
    '-- Med-Minder',
  ].join('\n')
}

let cachedTransporter: nodemailer.Transporter | null = null

function hasSmtpConfiguration(): boolean {
  return Boolean(
    serverConfig.smtp.host
    && serverConfig.smtp.user
    && serverConfig.smtp.password
    && serverConfig.smtp.from,
  )
}

function getSmtpTransporter(): nodemailer.Transporter | null {
  if (!hasSmtpConfiguration()) {
    return null
  }

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: serverConfig.smtp.host,
      port: serverConfig.smtp.port,
      secure: serverConfig.smtp.port === 465,
      auth: {
        user: serverConfig.smtp.user,
        pass: serverConfig.smtp.password,
      },
    })
  }

  return cachedTransporter
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
  return sendTransactionalEmail({
    to: payload.to,
    subject: buildEmailSubject(payload),
    text: buildPlainTextBody(payload),
  })
}

export async function sendTransactionalEmail(
  payload: TransactionalEmailPayload,
): Promise<boolean> {
  const transporter = getSmtpTransporter()

  if (!transporter) {
    // SMTP not configured — log only so the scheduler still runs in dev.
    console.log(
      `[email-stub] ${payload.to} | ${payload.subject} | ${payload.text}`,
    )
    return false
  }

  try {
    await transporter.sendMail({
      from: serverConfig.smtp.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
    })
    return true
  } catch (error) {
    console.error(`[email] Failed to send email to ${payload.to}:`, error)
    return false
  }
}

export interface ExportEmailPayload {
  to: string
  subject: string
  filename: string
  content: string
  mimeType: string
}

export async function sendExportEmail(payload: ExportEmailPayload): Promise<boolean> {
  const transporter = getSmtpTransporter()

  if (!transporter) {
    console.log(`[email-stub] export email to ${payload.to} | ${payload.filename}`)
    return false
  }

  try {
    await transporter.sendMail({
      from: serverConfig.smtp.from,
      to: payload.to,
      subject: payload.subject,
      text: 'Please find your Med-Minder export attached.\n\n-- Med-Minder',
      attachments: [
        {
          filename: payload.filename,
          content: payload.content,
          contentType: payload.mimeType,
        },
      ],
    })
    return true
  } catch (error) {
    console.error(`[email] Failed to send export email to ${payload.to}:`, error)
    return false
  }
}
