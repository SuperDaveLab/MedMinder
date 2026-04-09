import { serverConfig } from './config'
import { sendNotificationEmail } from './emailNotifier'

function getToAddress(): string {
  const fromEnv = process.env.TEST_EMAIL_TO?.trim()
  if (fromEnv) {
    return fromEnv
  }

  const fallback = serverConfig.smtp.user.trim()
  if (fallback) {
    return fallback
  }

  throw new Error('TEST_EMAIL_TO is required when SMTP_USER is not set.')
}

async function main(): Promise<void> {
  const to = getToAddress()
  const sent = await sendNotificationEmail({
    to,
    patientName: 'Sample Patient',
    candidate: {
      medicationId: 'manual-email-test',
      patientId: 'sample-patient-id',
      medicationName: 'Nexpill',
      kind: 'due-now',
      nextEligibleAtIso: new Date().toISOString(),
      dedupeKey: `manual-email-test-${String(Date.now())}`,
      title: 'Nexpill SMTP test',
      body: 'If you received this email, SMTP delivery is working.',
    },
  })

  if (!sent) {
    throw new Error('Email was not sent. Verify SMTP_* values in /etc/nexpill/api.env.')
  }

  console.log(`SMTP test email sent to ${to}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
