import twilio from 'twilio'
import type { ReminderNotificationCandidate } from '../src/reminders/notifications'
import { serverConfig } from './config'

let twilioClient: ReturnType<typeof twilio> | null = null

function hasTwilioConfiguration(): boolean {
  return Boolean(
    serverConfig.twilio.accountSid
    && serverConfig.twilio.authToken
    && serverConfig.twilio.fromNumber,
  )
}

function getTwilioClient(): ReturnType<typeof twilio> | null {
  if (!hasTwilioConfiguration()) {
    return null
  }

  if (!twilioClient) {
    twilioClient = twilio(
      serverConfig.twilio.accountSid,
      serverConfig.twilio.authToken,
    )
  }

  return twilioClient
}

function buildSmsBody(candidate: ReminderNotificationCandidate): string {
  return `${candidate.title} ${candidate.body}`
}

export async function sendNotificationSms(
  to: string,
  candidate: ReminderNotificationCandidate,
): Promise<boolean> {
  const client = getTwilioClient()

  if (!client) {
    return false
  }

  try {
    await client.messages.create({
      to,
      from: serverConfig.twilio.fromNumber,
      body: buildSmsBody(candidate),
    })

    return true
  } catch (error) {
    console.error(`[sms] Failed to send SMS to ${to}:`, error)
    return false
  }
}
