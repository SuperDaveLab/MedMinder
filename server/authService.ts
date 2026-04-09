import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type {
  AccountSessionSummary,
  AuthAccount,
  AuthSession,
  AuthTokenSet,
  CreateAccountRequest,
  CreateAccountResponse,
  SignInWithPasswordRequest,
  SignInWithPasswordResponse,
} from '../src/domain/auth'
import {
  defaultNotificationDeliveryPolicy,
  type NotificationDeliveryPolicy,
  notificationDeliveryPolicies,
} from '../src/domain/notificationPolicy'
import { dbPool } from './db'
import { sendTransactionalEmail } from './emailNotifier'
import { serverConfig } from './config'

interface AuthUserRecord {
  user_id: string
  account_id: string
  email: string
  phone_e164: string | null
  notification_delivery_policy: string | null
  password_hash: string
  created_at: Date
}

interface DbUserRow extends RowDataPacket, AuthUserRecord {}

interface PasswordResetTokenRow extends RowDataPacket {
  token_id: string
  account_id: string
  user_id: string
  email: string
  password_hash: string
  token_hash: string
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

interface SessionSummaryRow extends RowDataPacket {
  session_id: string
  provider: string
  issued_at: Date
  expires_at: Date
}

export class AuthServiceError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthServiceError'
    this.statusCode = statusCode
  }
}

function assertValidNewPassword(newPassword: string): void {
  if (!newPassword || newPassword.trim().length === 0) {
    throw new AuthServiceError(400, 'New password is required.')
  }

  if (newPassword.length < 10) {
    throw new AuthServiceError(400, 'New password must be at least 10 characters.')
  }
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildPasswordResetLink(baseUrl: string, token: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('view', 'more')
  url.searchParams.set('resetToken', token)
  return url.toString()
}

function buildPasswordResetEmailBody(resetLink: string): string {
  return [
    'Nexpill password reset',
    '',
    'Use the link below to reset your password:',
    resetLink,
    '',
    `This link expires in ${String(serverConfig.passwordResetTokenTtlMinutes)} minutes and can only be used once.`,
    '',
    'If you did not request this, you can ignore this email.',
    '',
    '-- Nexpill',
  ].join('\n')
}

function buildSessionTimestamps(now: Date): { issuedAt: Date; expiresAt: Date; accessTokenExpiresAt: Date } {
  const issuedAt = new Date(now)
  const expiresAt = new Date(now.getTime() + serverConfig.sessionTtlDays * 24 * 60 * 60 * 1000)
  const accessTokenExpiresAt = new Date(
    now.getTime() + serverConfig.accessTokenTtlMinutes * 60 * 1000,
  )

  return { issuedAt, expiresAt, accessTokenExpiresAt }
}

function toAuthAccount(row: AuthUserRecord): AuthAccount {
  const notificationDeliveryPolicy = notificationDeliveryPolicies.includes(
    row.notification_delivery_policy as NotificationDeliveryPolicy,
  )
    ? (row.notification_delivery_policy as NotificationDeliveryPolicy)
    : defaultNotificationDeliveryPolicy

  return {
    accountId: row.account_id,
    userId: row.user_id,
    email: row.email,
    phoneE164: row.phone_e164 ?? undefined,
    notificationDeliveryPolicy,
    createdAt: row.created_at.toISOString(),
  }
}

function toTokenSet(accessToken: string, refreshToken: string, accessTokenExpiresAt: Date): AuthTokenSet {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
  }
}

async function issueSessionForUser(user: AuthUserRecord, provider: 'password'): Promise<{
  session: AuthSession
  tokens: AuthTokenSet
}> {
  const now = new Date()
  const { issuedAt, expiresAt, accessTokenExpiresAt } = buildSessionTimestamps(now)
  const sessionId = crypto.randomUUID()
  const accessToken = generateToken()
  const refreshToken = generateToken()

  await dbPool.query(
    `
      INSERT INTO sessions (
        session_id,
        account_id,
        user_id,
        provider,
        refresh_token_hash,
        issued_at,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      sessionId,
      user.account_id,
      user.user_id,
      provider,
      hashToken(refreshToken),
      issuedAt,
      expiresAt,
    ],
  )

  return {
    session: {
      sessionId,
      accountId: user.account_id,
      userId: user.user_id,
      provider,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    tokens: toTokenSet(accessToken, refreshToken, accessTokenExpiresAt),
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function createAccount(
  request: CreateAccountRequest,
): Promise<CreateAccountResponse> {
  const email = normalizeEmail(request.email)
  const password = request.password

  if (!email || !password) {
    throw new Error('Email and password are required.')
  }

  const [[existingUser]] = await dbPool.query<DbUserRow[]>(
    `SELECT user_id, account_id, email, phone_e164, notification_delivery_policy, password_hash, created_at FROM users WHERE email = ? LIMIT 1`,
    [email],
  )

  if (existingUser) {
    throw new Error('An account with this email already exists.')
  }

  const accountId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const createdAt = new Date()
  const passwordHash = await bcrypt.hash(password, 12)

  await dbPool.query(
    `INSERT INTO accounts (account_id, created_at) VALUES (?, ?)`,
    [accountId, createdAt],
  )

  await dbPool.query(
    `
      INSERT INTO users (user_id, account_id, email, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [userId, accountId, email, passwordHash, createdAt],
  )

  const userRow: AuthUserRecord = {
    user_id: userId,
    account_id: accountId,
    email,
    phone_e164: null,
    notification_delivery_policy: defaultNotificationDeliveryPolicy,
    password_hash: passwordHash,
    created_at: createdAt,
  }

  const { session, tokens } = await issueSessionForUser(userRow, 'password')

  return {
    account: toAuthAccount(userRow),
    session,
    tokens,
  }
}

export async function signInWithPassword(
  request: SignInWithPasswordRequest,
): Promise<SignInWithPasswordResponse> {
  const email = normalizeEmail(request.email)
  const password = request.password

  if (!email || !password) {
    throw new Error('Email and password are required.')
  }

  const [[userRow]] = await dbPool.query<DbUserRow[]>(
    `SELECT user_id, account_id, email, phone_e164, notification_delivery_policy, password_hash, created_at FROM users WHERE email = ? LIMIT 1`,
    [email],
  )

  if (!userRow) {
    throw new Error('Invalid email or password.')
  }

  const passwordMatches = await bcrypt.compare(password, userRow.password_hash)

  if (!passwordMatches) {
    throw new Error('Invalid email or password.')
  }

  const { session, tokens } = await issueSessionForUser(userRow, 'password')

  return {
    account: toAuthAccount(userRow),
    session,
    tokens,
  }
}

export async function signOutBySessionId(sessionId: string): Promise<void> {
  if (!sessionId.trim()) {
    return
  }

  await dbPool.query(
    `
      UPDATE sessions
      SET revoked_at = ?
      WHERE session_id = ?
    `,
    [new Date(), sessionId],
  )
}

export async function changePassword(
  accountId: string,
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!currentPassword || currentPassword.trim().length === 0) {
    throw new AuthServiceError(400, 'Current password is required.')
  }

  assertValidNewPassword(newPassword)

  const [[userRow]] = await dbPool.query<DbUserRow[]>(
    `SELECT user_id, account_id, email, phone_e164, notification_delivery_policy, password_hash, created_at
     FROM users
     WHERE account_id = ? AND user_id = ?
     LIMIT 1`,
    [accountId, userId],
  )

  if (!userRow) {
    throw new AuthServiceError(404, 'Account not found.')
  }

  const currentPasswordMatches = await bcrypt.compare(currentPassword, userRow.password_hash)

  if (!currentPasswordMatches) {
    throw new AuthServiceError(403, 'Current password is incorrect.')
  }

  const passwordIsUnchanged = await bcrypt.compare(newPassword, userRow.password_hash)

  if (passwordIsUnchanged) {
    throw new AuthServiceError(400, 'New password must be different from current password.')
  }

  const nextPasswordHash = await bcrypt.hash(newPassword, 12)
  const revokedAt = new Date()

  await dbPool.query(
    `UPDATE users
     SET password_hash = ?
     WHERE account_id = ? AND user_id = ?`,
    [nextPasswordHash, accountId, userId],
  )

  await dbPool.query(
    `UPDATE sessions
     SET revoked_at = ?
     WHERE account_id = ?
       AND user_id = ?
       AND session_id <> ?
       AND revoked_at IS NULL`,
    [revokedAt, accountId, userId, currentSessionId],
  )
}

export async function requestPasswordReset(
  email: string,
  appBaseUrl: string,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new AuthServiceError(400, 'Email is required.')
  }

  const [[userRow]] = await dbPool.query<DbUserRow[]>(
    `SELECT user_id, account_id, email, phone_e164, notification_delivery_policy, password_hash, created_at
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [normalizedEmail],
  )

  if (!userRow) {
    return
  }

  const trimmedBaseUrl = appBaseUrl.trim()

  if (!trimmedBaseUrl) {
    throw new AuthServiceError(500, 'Password reset is not configured correctly.')
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const tokenId = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(
    createdAt.getTime() + serverConfig.passwordResetTokenTtlMinutes * 60 * 1000,
  )

  await dbPool.query(
    `UPDATE password_reset_tokens
     SET used_at = ?
     WHERE user_id = ? AND used_at IS NULL`,
    [createdAt, userRow.user_id],
  )

  await dbPool.query(
    `INSERT INTO password_reset_tokens (
      token_id,
      account_id,
      user_id,
      token_hash,
      expires_at,
      used_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [tokenId, userRow.account_id, userRow.user_id, tokenHash, expiresAt, createdAt],
  )

  const resetLink = buildPasswordResetLink(trimmedBaseUrl, token)

  await sendTransactionalEmail({
    to: userRow.email,
    subject: 'Nexpill password reset',
    text: buildPasswordResetEmailBody(resetLink),
  })
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || token.trim().length === 0) {
    throw new AuthServiceError(400, 'Password reset token is required.')
  }

  assertValidNewPassword(newPassword)

  const tokenHash = hashToken(token)
  const [[tokenRow]] = await dbPool.query<PasswordResetTokenRow[]>(
    `SELECT
       prt.token_id,
       prt.account_id,
       prt.user_id,
       prt.token_hash,
       prt.expires_at,
       prt.used_at,
       prt.created_at,
       u.email,
       u.password_hash
     FROM password_reset_tokens prt
     JOIN users u ON u.user_id = prt.user_id
     WHERE prt.token_hash = ?
     LIMIT 1`,
    [tokenHash],
  )

  if (!tokenRow || tokenRow.used_at || tokenRow.expires_at.getTime() <= Date.now()) {
    throw new AuthServiceError(400, 'Password reset link is invalid or expired.')
  }

  const passwordIsUnchanged = await bcrypt.compare(newPassword, tokenRow.password_hash)

  if (passwordIsUnchanged) {
    throw new AuthServiceError(400, 'New password must be different from current password.')
  }

  const nextPasswordHash = await bcrypt.hash(newPassword, 12)
  const completedAt = new Date()

  await dbPool.query(
    `UPDATE users
     SET password_hash = ?
     WHERE account_id = ? AND user_id = ?`,
    [nextPasswordHash, tokenRow.account_id, tokenRow.user_id],
  )

  await dbPool.query(
    `UPDATE password_reset_tokens
     SET used_at = ?
     WHERE user_id = ? AND used_at IS NULL`,
    [completedAt, tokenRow.user_id],
  )

  await dbPool.query(
    `UPDATE sessions
     SET revoked_at = ?
     WHERE account_id = ?
       AND user_id = ?
       AND revoked_at IS NULL`,
    [completedAt, tokenRow.account_id, tokenRow.user_id],
  )
}

export async function getAccountById(accountId: string): Promise<AuthAccount> {
  const [[userRow]] = await dbPool.query<DbUserRow[]>(
    `SELECT user_id, account_id, email, phone_e164, notification_delivery_policy, password_hash, created_at
     FROM users
     WHERE account_id = ?
     LIMIT 1`,
    [accountId],
  )

  if (!userRow) {
    throw new Error('Account not found.')
  }

  return toAuthAccount(userRow)
}

export async function updateAccountPhoneE164(
  accountId: string,
  phoneE164?: string | null,
  notificationDeliveryPolicy?: NotificationDeliveryPolicy,
  shouldUpdatePhoneE164 = true,
): Promise<AuthAccount> {
  const normalizedPolicy = notificationDeliveryPolicy
    && notificationDeliveryPolicies.includes(notificationDeliveryPolicy)
    ? notificationDeliveryPolicy
    : undefined

  await dbPool.query(
    `
      UPDATE users
      SET
        phone_e164 = CASE WHEN ? THEN ? ELSE phone_e164 END,
        notification_delivery_policy = COALESCE(?, notification_delivery_policy)
      WHERE account_id = ?
    `,
    [shouldUpdatePhoneE164, phoneE164 ?? null, normalizedPolicy ?? null, accountId],
  )

  return getAccountById(accountId)
}

export async function listActiveSessions(
  accountId: string,
  userId: string,
  currentSessionId: string,
): Promise<AccountSessionSummary[]> {
  const [rows] = await dbPool.query<SessionSummaryRow[]>(
    `SELECT session_id, provider, issued_at, expires_at
     FROM sessions
     WHERE account_id = ?
       AND user_id = ?
       AND revoked_at IS NULL
       AND expires_at > ?
     ORDER BY issued_at DESC`,
    [accountId, userId, new Date()],
  )

  return rows.map((row) => ({
    sessionId: row.session_id,
    provider: row.provider as AuthSession['provider'],
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    isCurrent: row.session_id === currentSessionId,
  }))
}

export async function revokeOtherSessions(
  accountId: string,
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const [result] = await dbPool.query<ResultSetHeader>(
    `UPDATE sessions
     SET revoked_at = ?
     WHERE account_id = ?
       AND user_id = ?
       AND session_id <> ?
       AND revoked_at IS NULL
       AND expires_at > ?`,
    [new Date(), accountId, userId, currentSessionId, new Date()],
  )

  return result.affectedRows ?? 0
}
