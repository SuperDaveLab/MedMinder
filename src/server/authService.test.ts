import { beforeEach, describe, expect, it, vi } from 'vitest'

const { compareMock, hashMock, queryMock } = vi.hoisted(() => ({
  compareMock: vi.fn(),
  hashMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: compareMock,
    hash: hashMock,
  },
}))

vi.mock('../../server/db', () => ({
  dbPool: {
    query: queryMock,
  },
}))

import { AuthServiceError, changePassword } from '../../server/authService'

describe('authService changePassword', () => {
  beforeEach(() => {
    compareMock.mockReset()
    hashMock.mockReset()
    queryMock.mockReset()
  })

  it('rejects when current password is incorrect', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        user_id: 'user-1',
        account_id: 'account-1',
        email: 'caregiver@example.com',
        phone_e164: null,
        notification_delivery_policy: 'push_then_email_fallback',
        password_hash: 'stored-hash',
        created_at: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]])
    compareMock.mockResolvedValueOnce(false)

    await expect(
      changePassword('account-1', 'user-1', 'session-1', 'wrong-password', 'new-password-123'),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Current password is incorrect.',
    } satisfies Partial<AuthServiceError>)

    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when new password is unchanged', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        user_id: 'user-1',
        account_id: 'account-1',
        email: 'caregiver@example.com',
        phone_e164: null,
        notification_delivery_policy: 'push_then_email_fallback',
        password_hash: 'stored-hash',
        created_at: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]])
    compareMock.mockResolvedValueOnce(true)
    compareMock.mockResolvedValueOnce(true)

    await expect(
      changePassword('account-1', 'user-1', 'session-1', 'current-password', 'current-password'),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'New password must be different from current password.',
    } satisfies Partial<AuthServiceError>)
  })

  it('updates password hash and revokes other sessions on success', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        user_id: 'user-1',
        account_id: 'account-1',
        email: 'caregiver@example.com',
        phone_e164: null,
        notification_delivery_policy: 'push_then_email_fallback',
        password_hash: 'stored-hash',
        created_at: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]])
    queryMock.mockResolvedValueOnce([{}])
    queryMock.mockResolvedValueOnce([{}])
    compareMock.mockResolvedValueOnce(true)
    compareMock.mockResolvedValueOnce(false)
    hashMock.mockResolvedValueOnce('new-hash')

    await changePassword('account-1', 'user-1', 'session-1', 'current-password', 'new-password-123')

    expect(hashMock).toHaveBeenCalledWith('new-password-123', 12)
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users'),
      ['new-hash', 'account-1', 'user-1'],
    )
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE sessions'),
      [expect.any(Date), 'account-1', 'user-1', 'session-1'],
    )
  })
})