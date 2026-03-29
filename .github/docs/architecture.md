# Med-Minder Architecture

## Purpose
Med-Minder is a local-first PWA for tracking medication timing for one or more patients.

Its primary job is to help caregivers answer:
- what was given
- when it was given
- when the next dose becomes eligible
- whether a medication is eligible now
- when reminders should appear

## Non-Goals for MVP
- No diagnosis
- No treatment recommendations
- No drug interaction engine
- No cloud sync
- No clinician portal
- No OCR-first workflow

## Proposed Stack
- React
- TypeScript
- Vite
- PWA plugin
- local persistence
- Vitest for unit tests

## Architectural Priorities
1. Correct timing engine
2. Clear audit trail of dose events
3. Mobile-first UX
4. Offline behavior
5. Maintainable separation of concerns

## Folder Responsibilities

### `src/domain/`
Shared types and domain models

### `src/engine/`
Pure functions for:
- interval calculations
- PRN eligibility
- fixed-time schedules
- taper rules
- reminder calculations
- status formatting inputs

### `src/storage/`
Persistence layer for:
- patients
- medications
- schedules
- dose history
- settings

### `src/features/`
Feature-oriented UI and local orchestration

### `src/components/`
Reusable presentational components

## Core Domain Objects

### Patient
Represents a person receiving medications.

### Medication
Represents a medication definition including schedule type and basic display info.

### DoseEvent
Represents a logged administration event.

### ReminderSettings
Represents notification preferences.

## Core Engine Contract
The key engine should produce a medication status object from:
- medication definition
- schedule data
- dose history
- current time
- reminder settings

Example output:
- eligibleNow
- nextEligibleAt
- lastGivenAt
- overdueDurationMinutes
- tooEarlyByMinutes
- reminderAt
- statusLabel

## Important Product Decisions
- Timing logic must be deterministic and testable.
- The UI should not implement medication timing rules directly.
- Time calculations must support odd intervals like 4h 45m.
- Taper schedules must be treated as first-class logic, not hacks layered onto interval meds.
- PRN meds should answer "eligible now?" clearly.

## Future Expansion Areas
- multi-caregiver sync
- export/share medication schedule
- doctor visit summary
- medication inventory tracking
- warnings based on vetted interaction datasets
- role-based caregiver notes