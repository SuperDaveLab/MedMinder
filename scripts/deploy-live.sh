#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
WEB_ROOT="${DEPLOY_WEB_ROOT:-/var/www/nexpill}"
WEB_BACKUP_ROOT="${DEPLOY_WEB_BACKUP_ROOT:-/var/www/nexpill-backups}"
API_ROOT="${DEPLOY_API_ROOT:-/opt/nexpill}"
API_SERVICE="${DEPLOY_API_SERVICE:-nexpill-api}"
API_PORT="${DEPLOY_API_PORT:-8788}"
PUBLIC_BASE_URL="${DEPLOY_PUBLIC_BASE_URL:-}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d-%H%M%S)}"
RUN_CHECKS=1

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-live.sh [options]

Options:
  --skip-checks        Skip npm ci/test/lint locally (still builds).
  --host <ssh-host>    SSH target (required if DEPLOY_HOST is not set)
  --public-base-url <url>
                       Public app base URL for external smoke checks.
  --release-id <id>    Override release ID used for backup naming.
  -h, --help           Show this help text.

Environment overrides:
  DEPLOY_HOST
  DEPLOY_WEB_ROOT
  DEPLOY_WEB_BACKUP_ROOT
  DEPLOY_API_ROOT
  DEPLOY_API_SERVICE
  DEPLOY_API_PORT
  DEPLOY_PUBLIC_BASE_URL
  RELEASE_ID
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks)
      RUN_CHECKS=0
      shift
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --public-base-url)
      PUBLIC_BASE_URL="$2"
      shift 2
      ;;
    --release-id)
      RELEASE_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Missing deployment host. Set DEPLOY_HOST or pass --host <ssh-host>." >&2
  exit 1
fi

for cmd in ssh rsync npm curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

echo "[deploy] release id: $RELEASE_ID"
echo "[deploy] host: $HOST"
echo "[deploy] web root: $WEB_ROOT"
echo "[deploy] api root: $API_ROOT"
echo "[deploy] api port: $API_PORT"
if [[ -n "$PUBLIC_BASE_URL" ]]; then
  echo "[deploy] public base url: $PUBLIC_BASE_URL"
fi

if [[ $RUN_CHECKS -eq 1 ]]; then
  echo "[deploy] running local verification: npm ci, npm test, npm run lint"
  npm ci
  npm test
  npm run lint
else
  echo "[deploy] skipping local ci/test/lint checks"
fi

echo "[deploy] building frontend"
npm run build

echo "[deploy] backing up live web root"
ssh -o BatchMode=yes "$HOST" "set -e; mkdir -p '$WEB_BACKUP_ROOT/$RELEASE_ID'; rsync -a --delete '$WEB_ROOT/' '$WEB_BACKUP_ROOT/$RELEASE_ID/'"

echo "[deploy] uploading frontend dist"
rsync -az --delete dist/ "$HOST:$WEB_ROOT/"

echo "[deploy] syncing API code"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.*' \
  ./ "$HOST:$API_ROOT/"

echo "[deploy] installing API deps and applying schema"
ssh -o BatchMode=yes "$HOST" "set -e; cd '$API_ROOT'; npm ci; set -a; source /etc/nexpill/api.env; set +a; npm run api:init-db"

echo "[deploy] restarting API service"
ssh -o BatchMode=yes "$HOST" "set -e; systemctl restart '$API_SERVICE'; systemctl is-active '$API_SERVICE'"

echo "[deploy] validating Apache and reloading"
ssh -o BatchMode=yes "$HOST" "set -e; apache2ctl configtest; systemctl reload apache2; systemctl is-active apache2"

echo "[deploy] smoke checks"
ssh -o BatchMode=yes "$HOST" "set -e; curl -fsS http://127.0.0.1:$API_PORT/health"
if [[ -n "$PUBLIC_BASE_URL" ]]; then
  curl -fsS "$PUBLIC_BASE_URL/api/notifications/push/public-key" >/dev/null
  curl -fsSI "$PUBLIC_BASE_URL" >/dev/null
else
  echo "[deploy] skipping external smoke checks (set DEPLOY_PUBLIC_BASE_URL to enable)"
fi

echo "[deploy] success"
echo "[deploy] backup: $WEB_BACKUP_ROOT/$RELEASE_ID"
