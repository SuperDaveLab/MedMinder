import type {
  DoseEvent,
  Medication,
  MedicationStatus,
} from '../domain/types'

/**
 * Reference-only engine contract for architecture/docs discussions.
 *
 * Runtime scheduling logic is implemented in `scheduling.ts`.
 * Keep this file as a non-runtime API reference unless we later migrate to
 * a contract-first implementation.
 */

/**
 * Pure scheduling engine contract input.
 *
 * - `medication`: schedule definition and reminder settings.
 * - `doseEvents`: all known events for this medication (may include corrected entries).
 * - `now`: current evaluation time.
 */
export interface ComputeMedicationStatusInput {
  medication: Medication
  doseEvents: DoseEvent[]
  now: Date
}

/**
 * Optional knobs for status calculation.
 * Keep this minimal and deterministic.
 */
export interface ComputeMedicationStatusOptions {
  dueSoonWindowMinutes?: number
}

/**
 * Contract for producing computed medication status for UI.
 *
 * Expected behavior (to be implemented in engine logic):
 *
 * - Interval medications:
 *   Calculate next eligibility by adding `intervalMinutes` from the latest valid dose.
 *   If no valid dose exists, treat according to initial interval policy defined by the engine.
 *
 * - PRN medications:
 *   Distinct from interval semantics.
 *   PRN is event-driven availability with a minimum lockout (`minimumIntervalMinutes`) and
 *   does not imply a fixed recurring due cadence.
 *
 * - Taper medications:
 *   Select the active taper rule by time window (`startDate`/`endDate`) and apply that rule's
 *   interval for eligibility calculations.
 *
 * - Corrected dose events:
 *   Ignore superseded events when a corrected entry (`corrected: true`) references
 *   `supersedesDoseEventId`.
 *
 * - Reminder timing:
 *   If reminders are enabled and `earlyReminderMinutes` is present, compute `reminderAt`
 *   as `nextEligibleAt - earlyReminderMinutes`.
 */
export function computeMedicationStatus(
  _input: ComputeMedicationStatusInput,
  _options: ComputeMedicationStatusOptions = {},
): MedicationStatus {
  throw new Error(
    'Non-runtime reference contract only. Use scheduling.ts for executable logic.',
  )
}
