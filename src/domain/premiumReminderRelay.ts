import type {
  ISODateString,
  Medication,
  MedicationSchedule,
  MedMinderState,
  ReminderSettings,
} from './types'
import { calculateMedicationSchedule } from '../engine/scheduling'

export const premiumReminderRelayChannels = ['web_push', 'email', 'sms'] as const
export type PremiumReminderRelayChannel = (typeof premiumReminderRelayChannels)[number]

export interface PremiumReminderRelaySubscription {
  relayAccountId: string
  timezone: string
  channels: PremiumReminderRelayChannel[]
  emailAddress?: string
  phoneNumber?: string
}

export interface PremiumReminderRelaySource {
  platform: 'pwa'
  appVersion?: string
  installationId?: string
}

export interface PremiumReminderRelayTimingSnapshot {
  lastGivenAt: ISODateString | null
  nextEligibleAt: ISODateString
  reminderAt: ISODateString | null
  eligibleNow: boolean
}

export interface PremiumReminderRelayMedicationSnapshot {
  medicationId: string
  patientId: string
  medicationName: string
  defaultDoseText: string
  strengthText?: string
  schedule: MedicationSchedule
  reminderSettings: ReminderSettings
  timing: PremiumReminderRelayTimingSnapshot
}

export interface PremiumReminderRelayPatientSnapshot {
  patientId: string
  displayName: string
}

export interface PremiumReminderSyncPayload {
  schemaVersion: 1
  generatedAt: ISODateString
  subscription: PremiumReminderRelaySubscription
  source: PremiumReminderRelaySource
  policy: {
    notificationKind: 'due_now'
    sendOncePerEligibilityWindow: true
  }
  patients: PremiumReminderRelayPatientSnapshot[]
  medications: PremiumReminderRelayMedicationSnapshot[]
}

export interface BuildPremiumReminderSyncPayloadOptions {
  now: Date
  subscription: PremiumReminderRelaySubscription
  source?: Partial<PremiumReminderRelaySource>
}

function isPremiumReminderEligibleMedication(medication: Medication): boolean {
  return medication.active && medication.reminderSettings?.enabled === true
}

/**
 * Build a full replacement snapshot for the premium reminder relay backend.
 *
 * Semantics:
 * - include only active medications with reminders explicitly enabled
 * - include only patients referenced by those medications
 * - include derived timing state so the backend can reconcile quickly
 * - omission means the record is no longer monitored by the relay
 */
export function buildPremiumReminderSyncPayload(
  appState: MedMinderState,
  options: BuildPremiumReminderSyncPayloadOptions,
): PremiumReminderSyncPayload {
  const monitoredMedications = appState.medications
    .filter(isPremiumReminderEligibleMedication)
    .map((medication) => {
      const schedule = calculateMedicationSchedule(
        medication,
        appState.doseEvents,
        options.now,
      )

      return {
        medicationId: medication.id,
        patientId: medication.patientId,
        medicationName: medication.name,
        defaultDoseText: medication.defaultDoseText,
        strengthText: medication.strengthText,
        schedule: medication.schedule,
        reminderSettings: medication.reminderSettings ?? { enabled: true },
        timing: {
          lastGivenAt: schedule.lastGivenAt?.toISOString() ?? null,
          nextEligibleAt: schedule.nextEligibleAt.toISOString(),
          reminderAt: schedule.reminderAt?.toISOString() ?? null,
          eligibleNow: schedule.eligibleNow,
        },
      }
    })

  const monitoredPatientIds = new Set(monitoredMedications.map((medication) => medication.patientId))
  const monitoredPatients = appState.patients
    .filter((patient) => monitoredPatientIds.has(patient.id))
    .map((patient) => ({
      patientId: patient.id,
      displayName: patient.displayName,
    }))

  return {
    schemaVersion: 1,
    generatedAt: options.now.toISOString(),
    subscription: options.subscription,
    source: {
      platform: 'pwa',
      appVersion: options.source?.appVersion,
      installationId: options.source?.installationId,
    },
    policy: {
      notificationKind: 'due_now',
      sendOncePerEligibilityWindow: true,
    },
    patients: monitoredPatients,
    medications: monitoredMedications,
  }
}