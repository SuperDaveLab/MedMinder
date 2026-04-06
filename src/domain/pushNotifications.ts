export interface WebPushSubscriptionPayload {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

export interface PushPublicKeyResponse {
  vapidPublicKey: string | null
}

export interface RegisterPushSubscriptionRequest {
  subscription: WebPushSubscriptionPayload
}

export interface DeletePushSubscriptionRequest {
  endpoint: string
}

export interface WebPushMessagePayload {
  title: string
  body: string
  tag: string
  url: string
  requireInteraction: boolean
}
