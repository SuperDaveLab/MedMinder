import { createPushApiClient } from '../cloud/pushClient'
import type { AuthSessionState } from '../domain/auth'
import type { WebPushSubscriptionPayload } from '../domain/pushNotifications'

function getApiBaseUrl(): string {
  return String(import.meta.env.VITE_API_BASE_URL ?? '')
}

function supportsPushRelay(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window.PushManager !== 'undefined'
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padded = `${base64String}${'='.repeat((4 - (base64String.length % 4)) % 4)}`
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

function toSubscriptionPayload(
  subscription: PushSubscription,
): WebPushSubscriptionPayload | null {
  const json = subscription.toJSON()

  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return null
  }

  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  }
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!supportsPushRelay()) {
    return null
  }

  await navigator.serviceWorker.ready
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function syncPushSubscription(
  authState: AuthSessionState | null,
  notificationPermission: NotificationPermission,
): Promise<void> {
  if (!authState || notificationPermission !== 'granted') {
    return
  }

  const registration = await getServiceWorkerRegistration()

  if (!registration) {
    return
  }

  const apiClient = createPushApiClient(getApiBaseUrl())
  const publicKeyResponse = await apiClient.getPublicKey()

  if (!publicKeyResponse.vapidPublicKey) {
    return
  }

  const existingSubscription = await registration.pushManager.getSubscription()
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKeyResponse.vapidPublicKey) as BufferSource,
  })

  const payload = toSubscriptionPayload(subscription)

  if (!payload) {
    return
  }

  await apiClient.upsertSubscription(authState, {
    subscription: payload,
  })
}

export async function unregisterPushSubscription(authState: AuthSessionState): Promise<void> {
  const registration = await getServiceWorkerRegistration()

  if (!registration) {
    return
  }

  const subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    return
  }

  const apiClient = createPushApiClient(getApiBaseUrl())

  try {
    await apiClient.deleteSubscription(authState, { endpoint: subscription.endpoint })
  } catch {
    // Ignore server cleanup failures and still unsubscribe locally.
  }

  await subscription.unsubscribe()
}
