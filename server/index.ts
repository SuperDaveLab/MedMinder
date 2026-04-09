import cors from 'cors'
import express from 'express'
import type { Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { dbPool, initializeAuthSchema } from './db'
import { applyCloudSyncRequest, getCloudAccountState, type AuthenticatedAccountContext } from './cloudService'
import { serverConfig } from './config'
import {
  AuthServiceError,
  changePassword,
  createAccount,
  getAccountById,
  listActiveSessions,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  signOutBySessionId,
  updateAccountPhoneE164,
} from './authService'
import { startNotificationScheduler } from './notificationScheduler'
import { sendExportEmail } from './emailNotifier'
import {
  deletePushSubscription,
  upsertPushSubscription,
} from './pushSubscriptionsService'
import { getPushPublicKey } from './pushNotifier'
import {
  getAccountNotificationChannels,
  upsertSmsPhone,
} from './notificationChannelsService'
import type {
  DeletePushSubscriptionRequest,
  RegisterPushSubscriptionRequest,
} from '../src/domain/pushNotifications'
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ListAccountSessionsResponse,
  RevokeOtherSessionsResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  UpdateAccountProfileRequest,
} from '../src/domain/auth'
import { notificationDeliveryPolicies } from '../src/domain/notificationPolicy'

const app = express()

app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

interface SessionLookupRow extends RowDataPacket {
  session_id: string
  account_id: string
  user_id: string
  expires_at: Date
  revoked_at: Date | null
}

async function requireSession(request: Request): Promise<AuthenticatedAccountContext> {
  const sessionId = String(request.header('x-nexpill-session-id') ?? '').trim()

  if (!sessionId) {
    throw new Error('Missing session id.')
  }

  const [rows] = await dbPool.query<SessionLookupRow[]>(
    `
      SELECT session_id, account_id, user_id, expires_at, revoked_at
      FROM sessions
      WHERE session_id = ?
      LIMIT 1
    `,
    [sessionId],
  )

  const session = rows[0]

  if (!session) {
    throw new Error('Session not found.')
  }

  if (session.revoked_at) {
    throw new Error('Session is revoked.')
  }

  if (session.expires_at.getTime() <= Date.now()) {
    throw new Error('Session is expired.')
  }

  return {
    accountId: session.account_id,
    userId: session.user_id,
    sessionId: session.session_id,
  }
}

function resolvePublicAppUrl(request: Request): string {
  return serverConfig.publicAppUrl.trim() || String(request.header('origin') ?? '').trim()
}

app.get('/health', (_request: Request, response: Response) => {
  response.status(200).json({ ok: true })
})

app.post('/api/auth/forgot-password', async (request: Request, response: Response) => {
  try {
    const payload = request.body as ForgotPasswordRequest
    await requestPasswordReset(String(payload?.email ?? ''), resolvePublicAppUrl(request))
    response.status(200).json({ success: true } satisfies ForgotPasswordResponse)
  } catch (error) {
    if (error instanceof AuthServiceError) {
      response.status(error.statusCode).json({ message: error.message })
      return
    }

    response.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to request password reset.',
    })
  }
})

app.post('/api/auth/reset-password', async (request: Request, response: Response) => {
  try {
    const payload = request.body as ResetPasswordRequest
    await resetPassword(String(payload?.token ?? ''), String(payload?.newPassword ?? ''))
    response.status(200).json({ success: true } satisfies ResetPasswordResponse)
  } catch (error) {
    if (error instanceof AuthServiceError) {
      response.status(error.statusCode).json({ message: error.message })
      return
    }

    response.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to reset password.',
    })
  }
})
app.get('/api/notifications/push/public-key', (_request: Request, response: Response) => {
  response.status(200).json({ vapidPublicKey: getPushPublicKey() })
})

app.get('/api/notifications/channels', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const channels = await getAccountNotificationChannels(account.accountId)
    response.status(200).json(channels)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to read notification channels.',
    })
  }
})

app.put('/api/notifications/channels', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const rawValue = request.body?.smsPhoneE164
    const smsPhoneE164 =
      typeof rawValue === 'string' && rawValue.trim().length > 0
        ? rawValue.trim()
        : null

    await upsertSmsPhone(account.accountId, smsPhoneE164)
    response.status(204).send()
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to update notification channels.',
    })
  }
})

app.post('/api/auth/register', async (request: Request, response: Response) => {
  try {
    const result = await createAccount(request.body)
    response.status(201).json(result)
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to create account.',
    })
  }
})

app.post('/api/auth/login', async (request: Request, response: Response) => {
  try {
    const result = await signInWithPassword(request.body)
    response.status(200).json(result)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to sign in.',
    })
  }
})

app.post('/api/auth/logout', async (request: Request, response: Response) => {
  const sessionId = String(request.body?.sessionId ?? '')
  await signOutBySessionId(sessionId)
  response.status(204).send()
})

app.post('/api/auth/change-password', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const payload = request.body as ChangePasswordRequest

    await changePassword(
      account.accountId,
      account.userId,
      account.sessionId,
      String(payload?.currentPassword ?? ''),
      String(payload?.newPassword ?? ''),
    )

    response.status(200).json({ success: true as const })
  } catch (error) {
    if (error instanceof AuthServiceError) {
      response.status(error.statusCode).json({ message: error.message })
      return
    }

    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to change password.',
    })
  }
})

app.get('/api/auth/sessions', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const sessions = await listActiveSessions(account.accountId, account.userId, account.sessionId)
    response.status(200).json({ sessions } satisfies ListAccountSessionsResponse)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to read account sessions.',
    })
  }
})

app.post('/api/auth/sessions/revoke-others', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const revokedCount = await revokeOtherSessions(account.accountId, account.userId, account.sessionId)
    response.status(200).json({ revokedCount } satisfies RevokeOtherSessionsResponse)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to revoke other sessions.',
    })
  }
})

app.get('/api/auth/account', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const profile = await getAccountById(account.accountId)
    response.status(200).json(profile)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to read account profile.',
    })
  }
})

app.put('/api/auth/account', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const payload = request.body as UpdateAccountProfileRequest
    const hasPhoneUpdate = payload && Object.prototype.hasOwnProperty.call(payload, 'phoneE164')
    const normalizedPhone =
      hasPhoneUpdate
        ? (typeof payload.phoneE164 === 'string' && payload.phoneE164.trim().length > 0
            ? payload.phoneE164.trim()
            : null)
        : undefined

    const normalizedPolicy =
      payload?.notificationDeliveryPolicy
      && notificationDeliveryPolicies.includes(payload.notificationDeliveryPolicy)
        ? payload.notificationDeliveryPolicy
        : undefined

    const updated = await updateAccountPhoneE164(
      account.accountId,
      normalizedPhone,
      normalizedPolicy,
      hasPhoneUpdate,
    )
    response.status(200).json(updated)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to update account profile.',
    })
  }
})

app.post('/api/cloud/sync', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const result = await applyCloudSyncRequest(account, request.body)
    response.status(200).json(result)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Sync not authorized.',
    })
  }
})

app.get('/api/cloud/state', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const state = await getCloudAccountState(account.accountId)
    response.status(200).json(state)
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Unable to read cloud state.',
    })
  }
})

app.post('/api/notifications/push/subscriptions', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const payload = request.body as RegisterPushSubscriptionRequest

    if (!payload?.subscription?.endpoint || !payload.subscription.keys?.auth || !payload.subscription.keys?.p256dh) {
      response.status(400).json({ message: 'Valid push subscription is required.' })
      return
    }

    await upsertPushSubscription(account.accountId, payload.subscription)
    response.status(204).send()
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Push subscription not authorized.',
    })
  }
})

app.delete('/api/notifications/push/subscriptions', async (request: Request, response: Response) => {
  try {
    const account = await requireSession(request)
    const payload = request.body as DeletePushSubscriptionRequest

    if (!payload?.endpoint) {
      response.status(400).json({ message: 'Push endpoint is required.' })
      return
    }

    await deletePushSubscription(account.accountId, payload.endpoint)
    response.status(204).send()
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Push unsubscription not authorized.',
    })
  }
})

app.use('/api', (_request: Request, response: Response) => {
  response.status(404).json({ message: 'API route not found.' })
})

app.post('/api/export/email', async (request: Request, response: Response) => {
  try {
    const accountContext = await requireSession(request)
    const account = await getAccountById(accountContext.accountId)
    const { filename, content, mimeType } = request.body as {
      filename?: unknown
      content?: unknown
      mimeType?: unknown
    }

    if (
      typeof filename !== 'string' || !filename.trim()
      || typeof content !== 'string'
      || typeof mimeType !== 'string' || !mimeType.trim()
    ) {
      response.status(400).json({ message: 'filename, content, and mimeType are required.' })
      return
    }

    const subject = `Nexpill export: ${filename}`
    const sent = await sendExportEmail({ to: account.email, subject, filename, content, mimeType })
    if (!sent) {
      response.status(503).json({ message: 'Export email service is unavailable right now.' })
      return
    }
    response.json({ sent: true })
  } catch (error) {
    response.status(401).json({
      message: error instanceof Error ? error.message : 'Export email failed.',
    })
  }
})

async function start(): Promise<void> {
  await initializeAuthSchema()

  startNotificationScheduler()

  app.listen(serverConfig.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Auth API listening on http://localhost:${String(serverConfig.port)}`)
  })
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Auth API failed to start.', error)
  process.exit(1)
})
