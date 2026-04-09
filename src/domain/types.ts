// ISO timestamp string, for example: 2026-03-28T20:30:00.000Z
export type ISODateString = string
// Date-only string in YYYY-MM-DD format, for example: 2026-03-28
export type LocalDateString = string
// Time-of-day string in HH:mm format, for example: 08:45
export type TimeOfDayHHmm = string

export const medicationScheduleTypes = ['interval', 'fixed_times', 'prn', 'taper'] as const
export type MedicationScheduleType = (typeof medicationScheduleTypes)[number]

export interface MedicationScheduleTypeOption {
  value: MedicationScheduleType
  label: string
}

export const medicationScheduleTypeOptions: MedicationScheduleTypeOption[] = [
  { value: 'interval', label: 'Every X hours' },
  { value: 'fixed_times', label: 'Specific times of day' },
  { value: 'prn', label: 'As needed (PRN)' },
  { value: 'taper', label: 'Taper schedule' },
]

export function getMedicationScheduleTypeLabel(type: MedicationScheduleType): string {
  return medicationScheduleTypeOptions.find((option) => option.value === type)?.label ?? type
}

export interface Patient {
  id: string
  displayName: string
  notes?: string
  notificationsEnabled?: boolean
}

export interface IntervalSchedule {
  type: 'interval'
  intervalMinutes: number
}

export interface FixedTimesSchedule {
  type: 'fixed_times'
  timesOfDay: TimeOfDayHHmm[]
}

export interface PrnSchedule {
  type: 'prn'
  minimumIntervalMinutes: number
}

export interface TaperRule {
  startDate: LocalDateString
  endDate?: LocalDateString
  intervalMinutes: number
}

export interface TaperSchedule {
  type: 'taper'
  rules: TaperRule[]
}

export type MedicationSchedule =
  | IntervalSchedule
  | FixedTimesSchedule
  | PrnSchedule
  | TaperSchedule

export interface ReminderSettings {
  enabled: boolean
  earlyReminderMinutes?: 0 | 10 | 15
  alarmEnabled?: boolean
}

export type MedicationStatusLabel =
  | 'eligible_now'
  | 'too_early'
  | 'due_soon'
  | 'overdue'
  | 'missed'
  | 'available_prn'
  | 'never_taken'

// Computed view model state, not a persisted domain record.
export interface MedicationStatus {
  scheduleType: MedicationScheduleType
  lastGivenAt?: ISODateString
  nextEligibleAt?: ISODateString
  eligibleNow: boolean
  minutesUntilEligible?: number
  tooEarlyByMinutes?: number
  overdueByMinutes?: number
  reminderAt?: ISODateString
  statusLabel: MedicationStatusLabel
}

export interface Medication {
  id: string
  patientId: string
  name: string
  strengthText?: string
  instructions?: string
  active: boolean
  defaultDoseText: string
  schedule: MedicationSchedule
  reminderSettings?: ReminderSettings
  overdueReminderIntervalMinutes?: number
  // Undefined should be treated as false for backward compatibility with older backups/cloud payloads.
  inventoryEnabled?: boolean
  initialQuantity?: number
  doseAmount?: number
  doseUnit?: string
  lowSupplyThreshold?: number
}

export type InventoryStatusLabel = 'inventory_ok' | 'low_supply' | 'out_of_stock'

export interface MedicationInventoryStatus {
  inventoryEnabled: boolean
  configured: boolean
  statusLabel: InventoryStatusLabel | null
  remainingQuantity: number | null
  quantityUsed: number
  effectiveDoseCount: number
  lowSupplyThreshold: number | null
}

export interface DoseEventBase {
  id: string
  medicationId: string
  timestampGiven: ISODateString
  doseText?: string
  givenBy?: string
  notes?: string
}

// Corrected DoseEvent entries are valid replacement events that supersede an earlier event.
export type DoseEvent = DoseEventBase & (
  | {
      corrected: false
      supersedesDoseEventId?: never
    }
  | {
      corrected: true
      supersedesDoseEventId: string
    }
)

export interface NexpillState {
  patients: Patient[]
  medications: Medication[]
  doseEvents: DoseEvent[]
}
