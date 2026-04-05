import type {
  DoseEvent,
  Medication,
  MedicationStatusLabel,
  MedicationStatus,
} from '../domain/types'
import { calculateMedicationSchedule } from './scheduling'

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
  input: ComputeMedicationStatusInput,
  options: ComputeMedicationStatusOptions = {},
): MedicationStatus {
  const scheduleResult = calculateMedicationSchedule(
    input.medication,
    input.doseEvents,
    input.now,
  )

  const dueSoonWindowMinutes = options.dueSoonWindowMinutes ?? 20
  const minutesUntilEligible = Math.max(
    0,
    Math.ceil((scheduleResult.nextEligibleAt.getTime() - input.now.getTime()) / 60_000),
  )

  let statusLabel: MedicationStatusLabel

  if (!scheduleResult.lastGivenAt) {
    statusLabel = 'never_taken'
  } else if (input.medication.schedule.type === 'prn' && scheduleResult.eligibleNow) {
    statusLabel = 'available_prn'
  } else if (!scheduleResult.eligibleNow) {
    statusLabel = minutesUntilEligible <= dueSoonWindowMinutes ? 'due_soon' : 'too_early'
  } else if ((scheduleResult.overdueByMinutes ?? 0) > 0) {
    statusLabel = 'overdue'
  } else {
    statusLabel = 'eligible_now'
  }

  return {
    scheduleType: input.medication.schedule.type,
    lastGivenAt: scheduleResult.lastGivenAt?.toISOString(),
    nextEligibleAt: scheduleResult.nextEligibleAt.toISOString(),
    eligibleNow: scheduleResult.eligibleNow,
    minutesUntilEligible,
    tooEarlyByMinutes: scheduleResult.tooEarlyByMinutes ?? undefined,
    overdueByMinutes: scheduleResult.overdueByMinutes ?? undefined,
    reminderAt: scheduleResult.reminderAt?.toISOString(),
    statusLabel,
  }
}
