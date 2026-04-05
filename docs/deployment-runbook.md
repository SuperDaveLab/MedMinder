# Med-Minder Deployment Runbook

This runbook is for deploying the static PWA build to the live host.

## Goal
Deploy the latest main branch build safely, with a quick rollback path.

## Prerequisites
- Access to repository and main branch
- SSH access to production host
- A web root served by nginx (or equivalent)
- Node.js and npm installed locally

## Standard Release Steps
1. Ensure local branch is up to date.
2. Run full local verification:
   - npm ci
   - npm test
   - npm run lint
   - npm run build
3. Create a timestamped release directory on the server.
4. Upload dist contents to that release directory.
5. Switch the current symlink to the new release.
6. Reload nginx.
7. Validate the live URL and PWA manifest/service worker.

## Example SSH + rsync Flow
Adjust these variables for your server:

- APP_HOST=your-server
- APP_USER=your-user
- APP_ROOT=/var/www/medminder
- RELEASE_ID=$(date +%Y%m%d-%H%M%S)

Local commands:

1) Build and verify
- npm ci
- npm test
- npm run lint
- npm run build

2) Create release directory
- ssh ${APP_USER}@${APP_HOST} "mkdir -p ${APP_ROOT}/releases/${RELEASE_ID}"

3) Upload build
- rsync -avz --delete dist/ ${APP_USER}@${APP_HOST}:${APP_ROOT}/releases/${RELEASE_ID}/

4) Activate release and reload web server
- ssh ${APP_USER}@${APP_HOST} "ln -sfn ${APP_ROOT}/releases/${RELEASE_ID} ${APP_ROOT}/current && sudo systemctl reload nginx"

## Rollback
If validation fails, point current back to the previous release and reload nginx:

- ssh ${APP_USER}@${APP_HOST} "ln -sfn ${APP_ROOT}/releases/<previous_release_id> ${APP_ROOT}/current && sudo systemctl reload nginx"

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
