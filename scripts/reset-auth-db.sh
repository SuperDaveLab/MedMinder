#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

: "${AUTH_DB_HOST:=127.0.0.1}"
: "${AUTH_DB_PORT:=3306}"
: "${AUTH_DB_USER:=nexpill_app}"
: "${AUTH_DB_PASSWORD:=}"
: "${AUTH_DB_NAME:=nexpill}"

if ! command -v mysql >/dev/null 2>&1; then
  echo "mysql client not found. Install mysql/mariadb client first." >&2
  exit 1
fi

MYSQL_PWD="$AUTH_DB_PASSWORD" mysql \
  -h "$AUTH_DB_HOST" \
  -P "$AUTH_DB_PORT" \
  -u "$AUTH_DB_USER" \
  "$AUTH_DB_NAME" <<'SQL'
CREATE TABLE IF NOT EXISTS accounts (
  account_id VARCHAR(36) PRIMARY KEY,
  created_at DATETIME(3) NOT NULL
);

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
);

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
    ON DELETE CASCADE
);

DELETE FROM sessions;
DELETE FROM users;
DELETE FROM accounts;
SQL

echo "Auth database reset complete for ${AUTH_DB_USER}@${AUTH_DB_HOST}:${AUTH_DB_PORT}/${AUTH_DB_NAME}."
