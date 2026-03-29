# Med-Minder

Med-Minder is a local-first medication timing tracker for one or more patients.
It helps caregivers answer:

- When is this medication next eligible?
- Is it eligible now?
- What doses were already given?
- When should I be reminded?

Version: v0.1.0 (MVP)

## MVP Scope

Included:

- schedule-aware status: eligible now, too early, due soon, overdue
- dose logging and correction history
- patient and medication administration
- local browser reminders (due soon and due now)
- backup and full restore from local JSON
- printable and text-exportable patient summary
- installable offline-capable PWA behavior

Not included:

- cloud sync
- authentication / accounts
- multi-device real-time sync
- drug interaction checks
- diagnosis or treatment advice

## Setup

Requirements:

- Node.js 20+
- npm 10+

Install and run:

1. Install dependencies:
   npm install
2. Start dev server:
   npm run dev
3. Run tests:
   npm test
4. Build production bundle:
   npm run build
5. Preview production bundle:
   npm run preview

## Daily Use

1. Open the app and select a patient.
2. In Care, review current medication status and tap Give Dose when administered.
3. In History, review logged events and corrections.
4. In Admin, manage patients and medications.
5. In Summary, print or export patient status for handoff.

## Backup and Restore

Backup export:

1. Open Admin.
2. Go to Backup and restore.
3. Select Export backup JSON.
4. Save the downloaded file in a safe location.

Restore import:

1. Open Admin.
2. Go to Backup and restore.
3. Select Import backup JSON.
4. Choose a previously exported backup file.
5. Confirm the warning prompt.

Important:

- Restore is full-replace. Existing local data is overwritten.
- Backups are local JSON files. Protect them as sensitive data.

## Data and Privacy

- All runtime data is stored locally in IndexedDB (database: med-minder-db).
- No backend is required for MVP use.
- Notification dedupe log is stored locally and pruned over time.

## Project Structure

- src/domain: strict domain model types
- src/engine: pure scheduling logic and tests
- src/storage: Dexie database and repository helpers
- src/ui: presentational UI components
- src/reminders: notification candidate and dedupe logic

## Known Limitations

- Data is tied to the current browser profile/device unless manually backed up and restored.
- Notification delivery behavior depends on browser and OS permission/background policies.
- No multi-user permission model is present in MVP.

## Safety Boundary

This app is a caregiver timing tool. It does not provide diagnosis, dosage recommendations, or treatment advice.

## License

No license has been selected yet.
