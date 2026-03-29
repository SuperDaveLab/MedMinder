# Med-Minder

## Project Description

Med-Minder is a local-first medication timing tracker for one or more patients.
It focuses on reliable next-eligible timing, simple dose logging, and an installable offline-capable PWA workflow.

## Tech Stack

- React 19
- TypeScript
- Vite
- vite-plugin-pwa
- Dexie (IndexedDB persistence)
- Vitest

## Architecture

- local-first client app (no backend)
- domain types in src/domain
- pure scheduling logic in src/engine
- IndexedDB repository layer in src/storage
- React UI in src/ui

## Supported Schedule Types

- interval
- fixed_times
- prn
- taper

## Current MVP Features

- schedule-aware medication status (eligible now, too early, due soon, overdue)
- dose logging with persisted reload behavior
- recent per-medication dose history (latest 5)
- selected patient persistence across reopen/refresh
- seeded local demo data for first run
- unit-tested scheduling engine plus app persistence flow test
- installable PWA build with offline precache support

## Not Yet Implemented

- dose correction UI workflow
- cloud sync
- authentication
- drug interaction checks

## Setup And Run

1. Install dependencies:
	npm install
2. Start development server:
	npm run dev
3. Run tests:
	npm test
4. Build production bundle:
	npm run build
5. Preview production bundle:
	npm run preview

## Project Structure

- src/domain: strict domain model types
- src/engine: scheduling logic and tests
- src/storage: Dexie database and repository functions
- src/data: sample seed state
- src/ui: presentational components

## Notes

- This app is a caregiver timing tool and does not provide medical diagnosis or treatment guidance.
- Browser notifications depend on permission and platform support.
- Runtime data is stored in IndexedDB database med-minder-db.
- src/engine/contract.ts is a non-runtime reference contract artifact.

## License

No license has been selected yet.
