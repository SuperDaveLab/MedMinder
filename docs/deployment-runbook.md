# Med-Minder Deployment Runbook

This runbook is for deploying the static PWA build to the live host.

## Goal
Deploy the latest main branch build safely, with a quick rollback path.

## Prerequisites
- Access to repository and main branch
- SSH access to production host
- A web root served by Apache/nginx (or equivalent)
- Node.js and npm installed locally

## Current Production Profile (as of 2026-04-05)
- Host: `medminder.davekoons.com`
- SSH user: `root`
- Web server: `apache2`
- Apache vhost `DocumentRoot`: `/var/www/medminder`
- Backup location: `/var/www/medminder-backups/<RELEASE_ID>`

## Standard Release Steps
1. Ensure local branch is up to date (`git pull --ff-only`).
2. Run full local verification:
    - `npm ci`
    - `npm test`
    - `npm run lint`
    - `npm run build`
3. Create a timestamped backup of the current live directory.
4. Sync local `dist/` into live `DocumentRoot`.
5. Validate web server config and reload the service.
6. Validate the live URL and PWA manifest/service worker.

## Canonical Apache Deploy Flow (Current Server)

Set release ID locally:

- `RELEASE_ID=$(date +%Y%m%d-%H%M%S)`

1) Build and verify
- `npm ci`
- `npm test`
- `npm run lint`
- `npm run build`

2) Create server backup
- `ssh -o BatchMode=yes root@medminder.davekoons.com "set -e; mkdir -p /var/www/medminder-backups/${RELEASE_ID}; rsync -a --delete /var/www/medminder/ /var/www/medminder-backups/${RELEASE_ID}/"`

3) Upload new build
- `rsync -avz --delete dist/ root@medminder.davekoons.com:/var/www/medminder/`

4) Validate + reload Apache
- `ssh -o BatchMode=yes root@medminder.davekoons.com "set -e; apache2ctl configtest; systemctl reload apache2; systemctl is-active apache2"`

5) Post-deploy smoke checks
- `curl -I https://medminder.davekoons.com`
- `curl -s https://medminder.davekoons.com/manifest.webmanifest | head -c 200`

## Rollback (Current Server)
If validation fails, restore from the backup created for that release:

- `ssh -o BatchMode=yes root@medminder.davekoons.com "set -e; rsync -a --delete /var/www/medminder-backups/<RELEASE_ID>/ /var/www/medminder/; apache2ctl configtest; systemctl reload apache2"`

## Generic Template (Other Hosts)
Use this only when not deploying to the current production host.

- Variables:
   - `APP_HOST=your-server`
   - `APP_USER=your-user`
   - `APP_ROOT=/var/www/medminder`
   - `RELEASE_ID=$(date +%Y%m%d-%H%M%S)`

- Example commands:
   - `ssh ${APP_USER}@${APP_HOST} "mkdir -p ${APP_ROOT}/releases/${RELEASE_ID}"`
   - `rsync -avz --delete dist/ ${APP_USER}@${APP_HOST}:${APP_ROOT}/releases/${RELEASE_ID}/`
   - `ssh ${APP_USER}@${APP_HOST} "ln -sfn ${APP_ROOT}/releases/${RELEASE_ID} ${APP_ROOT}/current && sudo systemctl reload nginx"`

## Post-Deploy Checks
- Open live app URL and hard refresh once
- Confirm manifest loads
- Confirm service worker updates
- Confirm primary views render: Care, History, Meds, More
- Confirm no console errors in browser devtools

## Notes for Future Copilot Sessions
When asked to deploy:
- Follow this runbook exactly
- Do not skip test/lint/build
- Confirm current git status is clean before deploying
- Ask for missing server variables instead of guessing
- Detect server stack (Apache/nginx) before issuing reload commands
