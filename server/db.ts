import mysql from 'mysql2/promise'
import { serverConfig } from './config'

export const dbPool = mysql.createPool({
  host: serverConfig.db.host,
  port: serverConfig.db.port,
  user: serverConfig.db.user,
  password: serverConfig.db.password,
  database: serverConfig.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
})

export async function initializeAuthSchema(): Promise<void> {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id VARCHAR(36) PRIMARY KEY,
      created_at DATETIME(3) NOT NULL
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id VARCHAR(36) PRIMARY KEY,
      account_id VARCHAR(36) NOT NULL,
      email VARCHAR(320) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_users_account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id)
        ON DELETE CASCADE
    )
  `)

  await dbPool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(32) NULL
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(36) PRIMARY KEY,
      account_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      provider VARCHAR(32) NOT NULL,
      refresh_token_hash VARCHAR(64) NOT NULL,
      issued_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      CONSTRAINT fk_sessions_account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id)
        ON DELETE CASCADE,
      CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,
      INDEX idx_sessions_user (user_id),
      INDEX idx_sessions_expires (expires_at)
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS cloud_patients (
      account_id VARCHAR(36) NOT NULL,
      patient_id VARCHAR(36) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (account_id, patient_id)
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS cloud_medications (
      account_id VARCHAR(36) NOT NULL,
      medication_id VARCHAR(36) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (account_id, medication_id)
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS cloud_dose_events (
      account_id VARCHAR(36) NOT NULL,
      dose_event_id VARCHAR(36) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (account_id, dose_event_id)
    )
  `)

  // Dedupe log for server-sent email notifications.
  // Keyed on (account_id, dedupe_key) to match the client-side reminder log format.
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS notification_log (
      account_id VARCHAR(36) NOT NULL,
      dedupe_key VARCHAR(512) NOT NULL,
      sent_at DATETIME(3) NOT NULL,
      PRIMARY KEY (account_id, dedupe_key),
      INDEX idx_notification_log_sent_at (sent_at)
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS notification_channels (
      account_id VARCHAR(36) PRIMARY KEY,
      sms_phone_e164 VARCHAR(32) NULL,
      updated_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_notification_channels_account
        FOREIGN KEY (account_id)
        REFERENCES accounts(account_id)
        ON DELETE CASCADE
    )
  `)

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      account_id VARCHAR(36) NOT NULL,
      endpoint VARCHAR(700) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (account_id, endpoint),
      INDEX idx_push_subscriptions_account_id (account_id)
    )
  `)
}
