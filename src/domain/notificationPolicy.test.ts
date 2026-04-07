import { describe, expect, it } from 'vitest'
import {
  defaultNotificationDeliveryPolicy,
  getNotificationDeliveryPolicyLabel,
  shouldAttemptEmail,
  shouldAttemptPush,
} from './notificationPolicy'

describe('notification delivery policy', () => {
  it('defaults to push with email fallback', () => {
    expect(defaultNotificationDeliveryPolicy).toBe('push_then_email_fallback')
    expect(getNotificationDeliveryPolicyLabel(defaultNotificationDeliveryPolicy)).toContain('Push first')
  })

  it('attempts channels based on selected policy', () => {
    expect(shouldAttemptPush('push_then_email_fallback')).toBe(true)
    expect(shouldAttemptEmail('push_then_email_fallback', true)).toBe(false)
    expect(shouldAttemptEmail('push_then_email_fallback', false)).toBe(true)

    expect(shouldAttemptPush('push_only')).toBe(true)
    expect(shouldAttemptEmail('push_only', false)).toBe(false)

    expect(shouldAttemptPush('email_only')).toBe(false)
    expect(shouldAttemptEmail('email_only', false)).toBe(true)

    expect(shouldAttemptPush('push_and_email')).toBe(true)
    expect(shouldAttemptEmail('push_and_email', true)).toBe(true)
    expect(shouldAttemptEmail('push_and_email', false)).toBe(true)
  })
})
