# Nexpill Product Modes and Cloud Intent

Last updated: 2026-04-06

## Intent

Nexpill supports two product modes in one app:

1. Local-first mode (default, free, open-source)
2. Account mode (optional, cloud-backed sync and premium reminder reliability)

The app must remain fully useful without an account.

## Mode 1: Local-first (default)

Principles:

- No account required.
- All patient, medication, and dose data remains on the user device.
- No backend visibility into user records.
- Works offline.
- Browser/PWA notification behavior is best-effort under platform limits.

User promise:

- Anyone can install and use Nexpill privately with no cloud dependency.

## Mode 2: Account mode (optional)

Principles:

- Account creation is optional, never required for base usage.
- Opting in to account mode means data is stored in cloud systems to enable sync and premium reliability features.
- Cloud becomes source of truth for account-mode users.
- Local storage becomes a cache for offline continuity.

User promise:

- Sign in once and restore/sync data across devices.
- Premium reminder delivery can use multiple channels (web push + email, optional SMS later).

## Explicit Tradeoff

Account mode trades strict local privacy for cross-device convenience and higher reminder reliability.

This tradeoff must be explicit in onboarding copy:

- Local-first mode: no cloud visibility.
- Account mode: records sync to cloud so reminders and multi-device restore can work.

## Why This Direction

Local-only browser storage can be cleared by users or platform policy. If premium reminders are active without cloud-backed account state, users can lose local control while server-side reminders continue.

Cloud source-of-truth in account mode addresses this by making preference and reminder control authoritative on the server.

## Non-Goals (initial account-mode phase)

- Not a medical advice platform.
- Not full collaboration/roles in v1.
- Not perfect real-time multi-user conflict-free editing on day one.

## Architecture Boundary

Keep domain scheduling logic platform-agnostic and reusable:

- Domain model and scheduling rules stay in shared TypeScript logic.
- Storage adapters differ by mode:
  - Local adapter for free mode.
  - Cloud-sync adapter for account mode.

## First Technical Milestones

1. Authentication and account identity
2. Cloud data model for patients, medications, dose events, reminder settings
3. Sync protocol (pull/push with versioning and conflict handling)
4. Premium notification endpoints and delivery policy (due-now, dedupe, channel fanout)
5. Account-mode controls: pause all reminders, per-med disable, endpoint revoke

## Recommended Starting Point

Start with account primitives and cloud data model before building delivery pipelines:

1. Define cloud entities and version fields.
2. Define a sync envelope contract that can carry full state and deltas.
3. Add account-mode feature flag and onboarding copy in app settings.
4. Implement read-only cloud restore flow first (sign in -> fetch -> hydrate local cache).
5. Implement write sync second (local edits -> push mutations).

This sequence reduces risk by proving identity, restore, and consistency before reminder fanout complexity.
