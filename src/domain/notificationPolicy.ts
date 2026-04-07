export const notificationDeliveryPolicies = [
  'push_then_email_fallback',
  'push_only',
  'email_only',
  'push_and_email',
] as const

export type NotificationDeliveryPolicy = (typeof notificationDeliveryPolicies)[number]

export const defaultNotificationDeliveryPolicy: NotificationDeliveryPolicy =
  'push_then_email_fallback'

export function getNotificationDeliveryPolicyLabel(
  policy: NotificationDeliveryPolicy,
): string {
  if (policy === 'push_then_email_fallback') {
    return 'Push first; email only if no push subscription delivers'
  }

  if (policy === 'push_only') {
    return 'Push only'
  }

  if (policy === 'email_only') {
    return 'Email only'
  }

  return 'Push and email'
}

export function shouldAttemptPush(policy: NotificationDeliveryPolicy): boolean {
  return policy === 'push_then_email_fallback' || policy === 'push_only' || policy === 'push_and_email'
}

export function shouldAttemptEmail(
  policy: NotificationDeliveryPolicy,
  pushDelivered: boolean,
): boolean {
  if (policy === 'email_only' || policy === 'push_and_email') {
    return true
  }

  if (policy === 'push_then_email_fallback') {
    return !pushDelivered
  }

  return false
}
