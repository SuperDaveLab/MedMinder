import { beforeEach, describe, expect, it, vi } from 'vitest'

const { compareMock, hashMock, queryMock, sendTransactionalEmailMock } = vi.hoisted(() => ({
  compareMock: vi.fn(),
  hashMock: vi.fn(),
  queryMock: vi.fn(),
  sendTransactionalEmailMock: vi.fn(),
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

vi.mock('../../server/emailNotifier', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}))

import {
  AuthServiceError,
  changePassword,
  listActiveSessions,
  revokeOtherSessions,
  requestPasswordReset,
  resetPassword,
} from '../../server/authService'

describe('authService changePassword', () => {
  beforeEach(() => {
    compareMock.mockReset()
    hashMock.mockReset()
    queryMock.mockReset()
    sendTransactionalEmailMock.mockReset()
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

  it('sends a reset link for an existing email', async () => {
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
    sendTransactionalEmailMock.mockResolvedValueOnce(true)

    await requestPasswordReset('caregiver@example.com', 'https://example.com/app')

    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE password_reset_tokens'),
      [expect.any(Date), 'user-1'],
    )
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO password_reset_tokens'),
      [
        expect.any(String),
        'account-1',
        'user-1',
        expect.any(String),
        expect.any(Date),
        expect.any(Date),
      ],
    )
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith({
      to: 'caregiver@example.com',
      subject: 'Med-Minder password reset',
      text: expect.stringContaining('https://example.com/app?view=more&resetToken='),
    })
  })

  it('returns successfully for unknown reset emails without sending mail', async () => {
    queryMock.mockResolvedValueOnce([[]])

    await requestPasswordReset('missing@example.com', 'https://example.com/app')

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(sendTransactionalEmailMock).not.toHaveBeenCalled()
  })

  it('resets the password, marks tokens used, and revokes sessions', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        token_id: 'token-1',
        account_id: 'account-1',
        user_id: 'user-1',
        email: 'caregiver@example.com',
        password_hash: 'stored-hash',
        token_hash: 'hashed-token',
        expires_at: new Date(Date.now() + 60_000),
        used_at: null,
        created_at: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]])
    queryMock.mockResolvedValueOnce([{}])
    queryMock.mockResolvedValueOnce([{}])
    queryMock.mockResolvedValueOnce([{}])
    compareMock.mockResolvedValueOnce(false)
    hashMock.mockResolvedValueOnce('new-hash')

    await resetPassword('reset-token', 'new-password-123')

    expect(hashMock).toHaveBeenCalledWith('new-password-123', 12)
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE users'),
      ['new-hash', 'account-1', 'user-1'],
    )
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE password_reset_tokens'),
      [expect.any(Date), 'user-1'],
    )
    expect(queryMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('UPDATE sessions'),
      [expect.any(Date), 'account-1', 'user-1'],
    )
  })

  it('lists active sessions and marks the current one', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        session_id: 'session-current',
        provider: 'password',
        issued_at: new Date('2026-04-09T10:00:00.000Z'),
        expires_at: new Date('2026-04-10T10:00:00.000Z'),
      },
      {
        session_id: 'session-other',
        provider: 'password',
        issued_at: new Date('2026-04-08T10:00:00.000Z'),
        expires_at: new Date('2026-04-10T10:00:00.000Z'),
      },
    ]])

    const sessions = await listActiveSessions('account-1', 'user-1', 'session-current')

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('SELECT session_id, provider, issued_at, expires_at'),
      ['account-1', 'user-1', expect.any(Date)],
    )
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      sessionId: 'session-current',
      isCurrent: true,
    })
    expect(sessions[1]).toMatchObject({
      sessionId: 'session-other',
      isCurrent: false,
    })
  })

  it('revokes other active sessions and returns affected count', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 2 }])

    const revokedCount = await revokeOtherSessions('account-1', 'user-1', 'session-current')

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sessions'),
      [expect.any(Date), 'account-1', 'user-1', 'session-current', expect.any(Date)],
    )
    expect(revokedCount).toBe(2)
  })
})