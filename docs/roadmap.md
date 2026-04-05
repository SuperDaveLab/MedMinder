# Med-Minder Product Roadmap (Working Draft)

Last updated: 2026-04-05

This roadmap captures candidate enhancements beyond current MVP scope, with prioritization and implementation notes.

## Prioritization Summary

### Next up (recommended)
1. Missed dose detection
2. Per-dose "given by" capture in UI
3. PWA update notification prompt

### Near-term polish
- Timezone-aware fixed-times settings

### Medium-term capabilities
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
