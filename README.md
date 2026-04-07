<div align="center">
  <img src="public/med-minder-icon.svg" width="100" height="100" alt="MedMinder Icon" />
  <h1>MedMinder</h1>
  <p>A beautiful, local-first progressive web app for tracking medication schedules.</p>
</div>

Med-Minder is a highly responsive, local-first medication timing tracker built for caregivers. It eliminates the cognitive load of tracking complex medication schedules (intervals, fixed times, PRN, and tapers) by answering a few simple questions at a glance:

- **When is this medication next eligible?**
- **Is it eligible now?**
- **What doses were already given?**
- **When should I be reminded?**

Built to be installed directly to your phone's home screen as a PWA, it behaves like a native app and supports an optional cloud account mode for multi-device sync and reminder relay.

## 📲 How to Use MedMinder

<div align="center">
   <p><strong><a href="https://medminder.superdavelab.com" target="_blank" rel="noopener noreferrer">🟢 Try the Live App!</a></strong></p>
</div>

The link above leads to the fully functional live production build. To get started:

1. **Install to your device**: Open the live link on your mobile browser (Safari/Chrome) and select **"Add to Home Screen"**. It will install directly to your device as a native-capable app.
2. **Make it yours**: A sample patient ("Alex Rivera") is loaded by default so you can see how things work. *It is completely safe to delete this patient and add your own!*
3. **Your data is your own**: Because MedMinder is architected to be completely local-first, **everything you log is saved exclusively locally on your device**. Deleting the sample data only clears your own local cache, and your personal health data will *never* be sent to our servers.

### 📱 Screenshots

<div style="display: flex; gap: 10px; flex-wrap: wrap;">
  <img src="public/screenshot-care.png" width="30%" alt="Care Dashboard" />
  <img src="public/screenshot-meds.png" width="30%" alt="Medication Management" />
  <img src="public/screenshot-history.png" width="30%" alt="Dose History" />
</div>

## 🚀 Features

- **Schedule-Aware Status Engine**: Automatically calculates if a medication is "Eligible now", "Due soon", "Too early", or "Overdue" natively within the browser format.
- **Complex Schedules Supported**: Fully supports `interval` (e.g. every 6 hours), `fixed_times` (e.g. 08:00 and 20:00), `prn` (as needed), and complex `taper` schedules!
- **Patient-first Workflow**: Dedicated Patients management, patient-scoped Meds view, and fast add/edit medication workflows optimized for mobile care rounds.
- **Local-first by Default**: By default, data is stored locally in IndexedDB (`med-minder-db`).
- **Complete History & Auditing**: See exactly what was given when, and log corrections that properly supersede accidental entries.
- **Smart Notifications**: Per-medication notification toggles, optional early notice (10/15 min), PRN default-off behavior, and overdue reminders.
- **Noise Reduction for Caregivers**: Notifications are grouped per patient so multiple due medications can be delivered as a single alert.
- **Optional Cloud Account Mode**: Sign in to sync data across devices and use server-backed reminder delivery channels.
- **Configurable Delivery Policy**: Choose `Push only`, `Email only`, `Push first, email fallback`, or `Push and email`.
- **In-App Alarm Mode**: For interval and fixed-time meds, enable alarm mode to trigger repeating in-app sound/vibration with acknowledge/snooze actions when due now.
- **Data Portability**: Full JSON backup export and import logic allows you to safely copy data across devices.

## ⏰ Alarm Behavior (Important)

MedMinder now supports an in-app alarm experience for eligible schedules (`interval` and `fixed_times`):

- Per-medication alarm toggle in **Meds**
- Repeating in-app sound + vibration pulses when due now
- Quick **Acknowledge** and **Snooze (5 min)** actions
- **Test alarm** button in **More → App Settings**

Because this is a browser/PWA app, true OS-native background alarm scheduling is limited by platform/browser rules. For reliability when the app is backgrounded, keep browser notifications enabled as well.

## 🔔 Reminder Limits

MedMinder can be a very capable installed PWA, but pure browser-local reminders are still subject to web platform limits:

- The app cannot schedule exact OS-level alarms the way a fully native mobile app can.
- Local browser notifications are best-effort and may be delayed or missed if the browser suspends the app, the device is aggressively power-managed, or notification permissions are disabled.
- In-app sound and vibration alarms are strongest while the app is open, installed, and allowed to stay active in the foreground.
- In local-only mode, reminder behavior is self-contained and does not have server-backed scheduling redundancy.

For best current reliability:

- Install the app to the home screen.
- Enable browser notifications.
- In account mode, choose **Push and email** if you want redundant delivery even when push appears successful on another device.
- Use the in-app alarm option for interval and fixed-time medications.
- Use Prevent sleep during active care windows when appropriate.

Current reminder behavior (implemented):

- Deactivated medications never generate notification candidates.
- Medications with notifications disabled never generate notification candidates.
- `due-soon` only applies when early reminder minutes is set to 10 or 15.
- PRN defaults notifications to off when reminder settings are unset.
- PRN emits a single `due-now` notification per eligibility window (no `due-soon` or recurring overdue buckets).
- Overdue notifications use a 30-minute default interval and support per-medication override in domain data.
- For policy "Push first, then email fallback", fallback email is sent only when push delivers to zero subscriptions for the account. If any device receives push, fallback email is skipped.

## ☁️ Cloud Account Mode and Reminder Relay

MedMinder now supports an optional cloud account mode.

Current behavior in account mode:

- Syncs patient, medication, and dose history across signed-in devices.
- Uses server-side reminder processing for push/email/SMS delivery channels.
- Supports delivery policy selection in-app:
   - `push_then_email_fallback`
   - `push_only`
   - `email_only`
   - `push_and_email`

Reliability note:

- `push_then_email_fallback` sends email only when push delivers to zero subscriptions for the account.
- If you want redundant reminders across channel variability, choose `push_and_email`.

## 🗺️ Roadmap

For planned enhancements and prioritization notes, see [docs/roadmap.md](docs/roadmap.md).

## 🛠️ Setup & Development

MedMinder is built heavily on React and Vite for blisteringly fast performance.

**Requirements:**
- Node.js 20+
- npm 10+

**Install and run:**

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the hot-reloading development server:
   ```bash
   npm run dev
   ```
3. Run test suite:
   ```bash
   npm test
   ```
4. Build for production:
   ```bash
   npm run build
   ```

### Local auth API (optional, for account mode testing)

The app now includes a local auth API stub backed by MySQL/MariaDB for account create/sign-in testing.

1. Ensure `.env` exists (or copy from `.env.example`) with auth DB settings.
2. Start the auth API:
   ```bash
   npm run api:dev
   ```
3. In a second terminal, start the app:
   ```bash
   npm run dev
   ```
4. Open **More -> Account (optional cloud sync)** and test:
   - Create account
   - Sign in
   - Sign out

Account-mode sync behavior (current implementation):

- On **Create account**, the app bootstraps your current local patient/medication/dose data to the server.
- After bootstrap succeeds, local clinical tables are reset and rehydrated from server state.
- On **Sign in**, local clinical tables are reset and replaced with server state.
- While signed in, local data changes are mirrored to the server whenever the app refreshes the patient view after a write.
- On **Sign out**, local clinical data is cleared.

To clear local auth users/sessions and start fresh:

```bash
npm run auth:db:reset
```

The Vite dev server proxies `/api/*` to `http://localhost:8787` by default.

## 🔒 Data and Privacy

Because MedMinder is a caregiver timing tool, privacy and reliability are paramount:
- **Local-first default**: Without signing in, data remains on-device and works offline.
- **Optional backend**: In account mode, data and reminder-delivery metadata are processed by the server to support sync and relay channels.
- **Manual portability**: Backup/export tools remain available for explicit data movement.

### Disclaimer
*This app is a caregiver timing tool. It does not provide diagnosis, dosage recommendations, or treatment advice.*

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
