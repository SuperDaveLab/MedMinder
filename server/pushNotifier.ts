import webpush from 'web-push'
import type { ReminderNotificationCandidate } from '../src/reminders/notifications'
import type { WebPushMessagePayload, WebPushSubscriptionPayload } from '../src/domain/pushNotifications'
import { serverConfig } from './config'
import {
  deletePushSubscription,
  listPushSubscriptions,
} from './pushSubscriptionsService'

let vapidConfigured = false

function hasPushConfiguration(): boolean {
  return Boolean(
    serverConfig.push.vapidPublicKey
    && serverConfig.push.vapidPrivateKey
    && serverConfig.push.vapidSubject,
  )
}

function ensureWebPushConfigured(): boolean {
  if (vapidConfigured) {
    return true
  }

  if (!hasPushConfiguration()) {
    return false
  }

  webpush.setVapidDetails(
    serverConfig.push.vapidSubject,
    serverConfig.push.vapidPublicKey,
    serverConfig.push.vapidPrivateKey,
  )

  vapidConfigured = true
  return true
}

function toPushMessage(candidate: ReminderNotificationCandidate): WebPushMessagePayload {
  return {
    title: candidate.title,
    body: candidate.body,
    tag: candidate.dedupeKey,
    url: '/?view=care',
    requireInteraction: candidate.kind !== 'due-soon',
  }
}

function isExpiredEndpointError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return false
  }

  const statusCode = (error as { statusCode?: number }).statusCode
  return statusCode === 404 || statusCode === 410
}

function toWebPushSubscription(subscription: WebPushSubscriptionPayload): webpush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: subscription.keys,
  }
}

export interface SendPushReminderResult {
  attempted: number
  delivered: number
}

export async function sendPushReminderNotification(
  accountId: string,
  candidate: ReminderNotificationCandidate,
): Promise<SendPushReminderResult> {
  if (!ensureWebPushConfigured()) {
    return { attempted: 0, delivered: 0 }
  }

  const subscriptions = await listPushSubscriptions(accountId)

  if (subscriptions.length === 0) {
    return { attempted: 0, delivered: 0 }
  }

  const payload = JSON.stringify(toPushMessage(candidate))
  let delivered = 0

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(toWebPushSubscription(subscription), payload, {
        TTL: 60,
      })
      delivered += 1
    } catch (error) {
      if (isExpiredEndpointError(error)) {
        await deletePushSubscription(accountId, subscription.endpoint)
      }

      console.error(
        `[push] Failed to send notification for account ${accountId}:`,
        error,
      )
    }
  }

  return {
    attempted: subscriptions.length,
    delivered,
  }
}

export function getPushPublicKey(): string | null {
  return serverConfig.push.vapidPublicKey || null
}
