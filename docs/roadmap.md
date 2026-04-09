# Nexpill Product Roadmap (Working Draft)

Last updated: 2026-04-08

This roadmap captures candidate enhancements beyond current MVP scope, with prioritization and implementation notes.

Related direction document:
- See [docs/product-modes-and-cloud-intent.md](docs/product-modes-and-cloud-intent.md) for the agreed product split between local-first mode and optional cloud account mode.

## Prioritization Summary

### Next up (recommended)
1. Account management and recovery
2. Missed dose detection
3. Per-dose "given by" capture in UI

### Near-term polish
- PWA update notification prompt

### Medium-term capabilities
- Session activity and device management
- Timeline/calendar view
- Multi-caregiver note workflows
- Medication inventory tracking

### Longer-term initiatives
- Optional cross-device sync
- Prescription label photo attachments
- Structured doctor-visit export (PDF)

---

## Feedback on Proposed Items

## Near-term (MVP polish)

### 0) Account management and recovery
Value: Very High
Effort: Medium-High
Risk: Medium

Why this is strong:
- Optional cloud account mode now exists, but account lifecycle functionality is still minimal.
- Users need basic self-service security and recovery before relying on cloud sync across devices.
- This reduces support burden and makes account mode feel complete rather than experimental.

Recommended phased rollout:
- Phase 1: change password while signed in.
- Phase 2: forgot-password email recovery and reset.
- Phase 3: session management and sign out other devices.
- Phase 4: verified email change.
- Phase 5: account deletion.

Guardrails:
- Keep local-only mode unaffected; no account should be required for base medication tracking.
- Treat recovery and security operations as server-authoritative.
- Revoke stale sessions after password reset/change.
- Hash recovery tokens and make them single-use with expiry.

Suggested acceptance criteria for the first slice:
- Signed-in user can change password with current password confirmation.
- Weak, blank, mismatched, or unchanged passwords are rejected with clear errors.
- Existing session behavior after password change is explicit and tested.
- UI and API tests cover success and failure paths.

### 1) Missed dose detection
Value: High
Effort: Medium
Risk: Low-Medium

Why this is strong:
- Very caregiver-relevant and safety-oriented for timing workflows.
- Builds directly on existing interval schedule logic.
- Clarifies a state that is currently only implied by "overdue".

Recommended first definition:
- For interval medications only: mark as missed when elapsed time since expected due exceeds 1.5x interval.
- Keep "missed" distinct from "overdue" in both card status and summary export.

Design guidance:
- New status label: missed (or missed_dose in domain status label taxonomy).
- UI wording example: "Missed dose window" or "Missed by X".
- Keep current overdue behavior for non-interval schedules unless explicitly expanded.

### 2) Per-dose "given by" field
Value: High
Effort: Low-Medium
Risk: Low

Why this is strong:
- Domain already supports givenBy.
- Useful for multi-caregiver accountability with minimal architecture change.

Recommended implementation:
- Add optional text input to Give Dose action.
- Persist with each new dose event.
- Surface in recent history and export.

### 3) Timezone-aware fixed-times
Value: Medium-High
Effort: Medium-High
Risk: Medium

Why this matters:
- Fixed-time schedules can drift semantically when caregivers travel or when timezone assumptions differ.

Recommended approach:
- Start with global timezone setting first (simpler UX and storage impact).
- Only add per-medication timezone if real caregiver scenarios require mixed-zone handling.

---

## Medium-term

### 4) Timeline / calendar view
Value: High
Effort: Medium
Risk: Low-Medium

Good for spotting patterns and missed windows quickly.

### 5) Multi-caregiver notes
Value: Medium-High
Effort: Low-Medium
Risk: Low

Mostly a UI/UX enhancement because notes and givenBy are already modeled.

### 6) Medication inventory tracker
Value: Medium-High
Effort: Medium
Risk: Medium

Needs careful UX around decrement events, corrections, and refill handling.

### 7) PWA update notification
Value: Medium
Effort: Low-Medium
Risk: Low

Good operational polish: replace silent auto-update behavior with explicit prompt.

---

## Longer-term

### 8) Cross-device sync (user-controlled backend)
Value: Very High
Effort: High
Risk: High

Largest architectural shift (conflicts, identity, encryption, merge semantics).

### 9) Photo attachment for labels
Value: Medium
Effort: Medium-High
Risk: Medium

Needs local storage strategy and compression policy.

### 10) Doctor visit export (structured PDF)
Value: Medium-High
Effort: Medium
Risk: Low-Medium

Natural progression from existing plain text summary export.

---

## Recommended Next Feature Brief: Missed Dose Detection

## Recommended Next Feature Brief: Account Management and Recovery

Scope roadmap:
- Phase 1: Change password while signed in.
- Phase 2: Forgot-password email recovery.
- Phase 3: Session/device management.
- Phase 4: Change email with verification.
- Phase 5: Account deletion.

Phase 1 implementation brief:
- Add a signed-in change-password form to the existing Account section in More.
- Require current password, new password, and confirm password.
- Add authenticated API endpoint for password change.
- Verify current password before hashing and storing the replacement password.
- Revoke other sessions after successful password change.
- Add validation and regression tests for wrong current password, mismatched confirmation, unchanged password, and success path.

Non-goals for Phase 1:
- Email-based recovery.
- Email address change.
- Device/session list UI.
- Account deletion.

Scope for first iteration:
- Schedule support: interval only.
- Rule: missed if now > expectedDueAt + (0.5 * intervalMinutes).
- Display:
  - Medication card status pill + status text
  - Summary row current status
- Non-goals for v1:
  - PRN, fixed_times, taper missed logic
  - retrospective missed-event backfilling

Suggested acceptance criteria:
- Interval medication transitions: due soon -> overdue -> missed.
- Missed state remains deterministic with corrected dose entries.
- Unit tests cover odd intervals, midnight rollover, and correction scenarios.
- Existing reminder and alarm behavior remains intact.

## Notes
- This roadmap is intentionally iterative.
- Priorities can be re-ordered based on caregiver feedback and observed usage.
