# Med-Minder Copilot Instructions

This repository is for **Med-Minder**, a local-first PWA that helps users track medication timing for one or more patients.

## Core Product Goal
The app must answer:
- When is this medication next eligible?
- Is it eligible now?
- When should I be reminded?
- What doses were already given?

## MVP Priorities
Focus on:
1. Correct medication timing calculations
2. Reliable dose logging
3. Simple mobile-first UX
4. Offline/local-first behavior
5. Installable PWA support

Do not prioritize:
- Backend/cloud sync
- Authentication
- Over-engineered abstractions
- AI/LLM features
- Medical diagnosis or treatment recommendations
- Drug interaction analysis unless explicitly requested later

## Architecture Rules
- Use **TypeScript** with strict typing.
- Prefer **pure functions** for scheduling and eligibility logic.
- Keep **domain logic**, **UI**, and **storage** separate.
- Do not mix React components with medication timing logic.
- Put scheduling logic under `src/engine/`.
- Put domain types under `src/domain/`.
- Put persistence code under `src/storage/`.
- UI components should consume already-computed status whenever possible.

## Domain Assumptions
Support these schedule types:
- `interval`: medication is eligible every X minutes/hours
- `fixed_times`: medication is due at specific times of day
- `prn`: medication is allowed as-needed, but only after a minimum interval
- `taper`: medication follows time-based taper rules that change over date ranges

The system must support:
- odd intervals like 4 hours 45 minutes
- exact timestamp calculations
- overdue status
- optional early reminders (10 or 15 minutes before)
- dose history
- corrected dose entries if a prior entry was wrong

## Safety / Medical Boundaries
This app is a caregiver timing tool, not a medical diagnosis engine.
Never generate:
- dosage advice
- taper recommendations
- treatment recommendations
- safety claims about combining medications
unless explicitly asked and clearly separated from the MVP scheduling logic.

When generating UI text, prefer wording like:
- "Next eligible at"
- "Eligible now"
- "Too early"
- "Overdue by"
Avoid wording that sounds like medical advice.

## Coding Preferences
- Prefer small files and focused functions.
- Avoid unnecessary class hierarchies.
- Prefer plain objects and functions over OOP-heavy designs unless clearly justified.
- Use descriptive names.
- Avoid clever code.
- Make date/time calculations explicit and testable.
- Do not silently assume timezone behavior.
- Keep formatting and structure consistent.

## Testing Expectations
For any scheduling logic:
- add or update unit tests
- cover edge cases
- include realistic examples

Important edge cases:
- midnight rollover
- multiple doses in one day
- odd intervals
- corrected entries
- taper boundary dates
- PRN lockout timing
- reminder offset timing
- daylight saving/timezone edge cases where applicable

## Implementation Approach
When asked to build a feature:
1. define or update domain types
2. implement engine logic
3. add tests
4. then wire UI
5. then persist state if needed

Do not jump straight into UI if the feature depends on calculation logic.

## UI Guidance
- Mobile-first
- Large tap targets
- Clear status labels
- Avoid clutter
- The most important information should be visible without digging:
  - medication name
  - last given
  - next eligible time
  - current eligibility status
  - give dose action

## Persistence Guidance
For MVP, prefer local persistence only.
Use a simple and reliable local storage approach suitable for a PWA.
Do not add a backend unless explicitly requested.

## When Unsure
Choose the simplest implementation that preserves correctness, readability, and testability.