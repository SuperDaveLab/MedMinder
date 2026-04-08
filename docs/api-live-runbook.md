# Med-Minder API Live Runbook

This runbook sets up the Node/Express auth + cloud API on a live Linux host.

## Goal

1. Provision database/user in MySQL.
2. Create required API tables.
3. Run API continuously via systemd.
4. Proxy `/api` from Apache to the API port.

## Assumptions

- Repo path on server: `/opt/med-minder`
- API port: `8787`
- Host (SSH): keep runtime-configured and out of committed docs
- Public app URL: keep runtime-configured and out of committed docs
- Apache serves the PWA and will reverse-proxy `/api`

Adjust paths/ports as needed.

## 1. Install Runtime Dependencies (server)

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm mysql-client
```

If your distro Node is old, install Node 20+ via NodeSource or nvm.

## 2. Deploy Repo and Install Packages

```bash
sudo mkdir -p /opt/med-minder
sudo chown "$USER":"$USER" /opt/med-minder
cd /opt/med-minder

# Use your preferred deploy method here (git pull, rsync, CI artifact, etc.)
npm ci
```

## 3. Create MySQL Database + App User

Run this as a MySQL admin user:

```sql
CREATE DATABASE IF NOT EXISTS medminder_auth
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'medminder_app'@'127.0.0.1' IDENTIFIED BY 'REPLACE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON medminder_auth.* TO 'medminder_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

If API host and DB host differ, grant on the correct host CIDR/name instead of `127.0.0.1`.

## 4. Create API Environment File

Create `/etc/medminder/api.env`:

```bash
sudo mkdir -p /etc/medminder
sudo tee /etc/medminder/api.env > /dev/null <<'EOF'
AUTH_API_PORT=8787
AUTH_DB_HOST=127.0.0.1
AUTH_DB_PORT=3306
AUTH_DB_USER=medminder_app
AUTH_DB_PASSWORD=REPLACE_ME_STRONG_PASSWORD
AUTH_DB_NAME=medminder_auth
AUTH_ACCESS_TOKEN_TTL_MINUTES=30
AUTH_SESSION_TTL_DAYS=30
NOTIFICATION_SCHEDULER_INTERVAL_MS=300000

# Web Push (required for backend push delivery)
PUSH_VAPID_PUBLIC_KEY=REPLACE_ME
PUSH_VAPID_PRIVATE_KEY=REPLACE_ME
PUSH_VAPID_SUBJECT=mailto:noreply@example.com

# Email fanout channel (optional until SMTP wired)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Med-Minder <noreply@example.com>

# SMS fanout channel (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
EOF

sudo chmod 600 /etc/medminder/api.env
```

## 5. Initialize/Upgrade Tables

This is safe to run repeatedly; it uses `CREATE TABLE IF NOT EXISTS`.

```bash
cd /opt/med-minder
set -a
source /etc/medminder/api.env
set +a
npm run api:init-db
```

Tables created include:

- `accounts`
- `users`
- `sessions`
- `cloud_patients`
- `cloud_medications`
- `cloud_dose_events`
- `notification_log`
- `notification_channels`
- `push_subscriptions`

## 6. Create systemd Service

Create `/etc/systemd/system/medminder-api.service`:

```ini
[Unit]
Description=Med-Minder Auth/Cloud API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/med-minder
EnvironmentFile=/etc/medminder/api.env
ExecStart=/usr/bin/npm run api:start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable medminder-api
sudo systemctl restart medminder-api
sudo systemctl status medminder-api --no-pager
```

Logs:

```bash
journalctl -u medminder-api -f
```

## 7. Apache Reverse Proxy for `/api`

Enable modules once:

```bash
sudo a2enmod proxy proxy_http headers
```

Inside your TLS vhost for your public Med-Minder domain, add:

```apache
ProxyPreserveHost On
ProxyPass /api http://127.0.0.1:8787/api
ProxyPassReverse /api http://127.0.0.1:8787/api
```

Then reload:

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

## 8. Verify Live API

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS https://your-public-domain.example/api/notifications/push/public-key
```

Expected:

- `/health` returns `{ "ok": true }`
- push public key endpoint returns `{ "vapidPublicKey": "..." }` when configured

## 9. Ongoing Deploy Steps (API)

On each release:

```bash
cd /opt/med-minder
git pull --ff-only
npm ci
set -a; source /etc/medminder/api.env; set +a
npm run api:init-db
sudo systemctl restart medminder-api
sudo systemctl status medminder-api --no-pager
```

## Notes

- Push is primary channel; email/SMS are additional fanout channels per reminder cycle.
- API credentials should remain server-owned. Users should only provide destination data (like SMS phone), not provider secrets.
