<div align="center">
  <img src="public/med-minder-icon.svg" width="100" height="100" alt="MedMinder Icon" />
  <h1>MedMinder</h1>
  <p>A beautiful, local-first progressive web app for tracking medication schedules.</p>
</div>

Med-Minder is a highly responsive, offline-first medication timing tracker built for caregivers. It eliminates the cognitive load of tracking complex medication schedules (intervals, fixed times, PRN, and tapers) by answering a few simple questions at a glance:

- **When is this medication next eligible?**
- **Is it eligible now?**
- **What doses were already given?**
- **When should I be reminded?**

Built to be installed directly to your phone's home screen as a PWA, it behaves exactly like a native app with zero cloud bloat.

### 📱 Screenshots

<div style="display: flex; gap: 10px; flex-wrap: wrap;">
  <img src="public/screenshot-care.png" width="30%" alt="Care Dashboard" />
  <img src="public/screenshot-meds.png" width="30%" alt="Medication Management" />
  <img src="public/screenshot-history.png" width="30%" alt="Dose History" />
</div>

## 🚀 Features

- **Schedule-Aware Status Engine**: Automatically calculates if a medication is "Eligible now", "Due soon", "Too early", or "Overdue" natively within the browser format.
- **Complex Schedules Supported**: Fully supports `interval` (e.g. every 6 hours), `fixed_times` (e.g. 08:00 and 20:00), `prn` (as needed), and complex `taper` schedules!
- **Local-first & Privacy-focused**: Your data never leaves your device. Everything is securely stored in IndexedDB (`med-minder-db`).
- **Complete History & Auditing**: See exactly what was given when, and log corrections that properly supersede accidental entries.
- **Local Notifications**: Opt-in to browser-based local notifications when medications become due!
- **Data Portability**: Full JSON backup export and import logic allows you to safely copy data across devices.

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

## 🔒 Data and Privacy

Because MedMinder is a caregiver timing tool, privacy and reliability are paramount:
- **No Backend**: There are no servers processing your data.
- **Offline Capable**: As a registered PWA, MedMinder functions without an internet connection.
- **Manual Sync**: Data is tied to the current browser profile unless you use the built-in backup and restore tooling to move it.

### Disclaimer
*This app is a caregiver timing tool. It does not provide diagnosis, dosage recommendations, or treatment advice.*

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
