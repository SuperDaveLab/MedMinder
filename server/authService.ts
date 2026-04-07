import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import type {
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
import { serverConfig } from './config'

interface DbUserRow {
  user_id: string
  account_id: string
  email: string
  phone_e164: string | null
  notification_delivery_policy: string | null
  password_hash: string
  created_at: Date
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildSessionTimestamps(now: Date): { issuedAt: Date; expiresAt: Date; accessTokenExpiresAt: Date } {
  const issuedAt = new Date(now)
  const expiresAt = new Date(now.getTime() + serverConfig.sessionTtlDays * 24 * 60 * 60 * 1000)
  const accessTokenExpiresAt = new Date(
    now.getTime() + serverConfig.accessTokenTtlMinutes * 60 * 1000,
  )

  return { issuedAt, expiresAt, accessTokenExpiresAt }
}

function toAuthAccount(row: DbUserRow): AuthAccount {
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

async function issueSessionForUser(user: DbUserRow, provider: 'password'): Promise<{
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

  const userRow: DbUserRow = {
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
