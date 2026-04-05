import {
  type DoseEvent,
  type FixedTimesSchedule,
  type IntervalSchedule,
  type Medication,
  type PrnSchedule,
  type ReminderSettings,
  type TaperSchedule,
  type TaperRule,
} from '../domain/types'

const MS_PER_MINUTE = 60_000

export type DueStatus = 'due-now' | 'due-soon' | 'not-due'

export interface MedicationTiming {
  medicationId: string
  nextEligibleAt: Date
  dueStatus: DueStatus
  minutesUntilEligible: number
}

export interface MedicationScheduleResult {
  medicationId: string
  lastGivenAt: Date | null
  expectedDueAt: Date
  nextEligibleAt: Date
  eligibleNow: boolean
  tooEarlyByMinutes: number | null
  overdueByMinutes: number | null
  reminderAt: Date | null
}

function toTimestamp(isoDateTime: string): number | null {
  const timestamp = Date.parse(isoDateTime)

  if (Number.isNaN(timestamp)) {
    return null
  }

  return timestamp
}

function fromTimestamp(timestamp: number): Date {
  return new Date(timestamp)
}

function parseLocalDateToTimestamp(localDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)

  if (!match) {
    return null
  }

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return timestamp
}

function parseTimeOfDay(timeLabel: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeLabel)

  if (!match) {
    return null
  }

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return { hours, minutes }
}

function sortByTakenAtDesc(history: DoseEvent[]): DoseEvent[] {
  return [...history].sort((a, b) => {
    const left = toTimestamp(a.timestampGiven) ?? Number.NEGATIVE_INFINITY
    const right = toTimestamp(b.timestampGiven) ?? Number.NEGATIVE_INFINITY

    if (left === right) {
      return b.id.localeCompare(a.id)
    }

    return right - left
  })
}

function getLatestValidDoseForMedication(
  medicationId: string,
  doseEvents: DoseEvent[],
): DoseEvent | undefined {
  const medicationEvents = doseEvents.filter(
    (doseEvent) => doseEvent.medicationId === medicationId,
  )
  const supersededIds = new Set(
    medicationEvents
      .filter((doseEvent) => doseEvent.corrected)
      .map((doseEvent) => doseEvent.supersedesDoseEventId)
      .filter((id): id is string => Boolean(id)),
  )

  return sortByTakenAtDesc(
    medicationEvents.filter(
      (doseEvent) =>
        !supersededIds.has(doseEvent.id) &&
        toTimestamp(doseEvent.timestampGiven) !== null,
    ),
  )[0]
}

function getLatestDueFromAnchor(
  anchorAt: Date,
  intervalMinutes: number,
  now: Date,
): Date {
  if (now.getTime() <= anchorAt.getTime()) {
    return anchorAt
  }

  const intervalMs = intervalMinutes * MS_PER_MINUTE
  const elapsedMs = now.getTime() - anchorAt.getTime()
  const intervalsElapsed = Math.floor(elapsedMs / intervalMs)

  return new Date(anchorAt.getTime() + intervalsElapsed * intervalMs)
}

function getActiveTaperRule(rules: TaperRule[], now: Date): TaperRule | undefined {
  const sortedRules = [...rules].sort(
    (a, b) =>
      (parseLocalDateToTimestamp(a.startDate) ?? Number.POSITIVE_INFINITY) -
      (parseLocalDateToTimestamp(b.startDate) ?? Number.POSITIVE_INFINITY),
  )

  const active = sortedRules.find((rule) => {
    const startsAt = parseLocalDateToTimestamp(rule.startDate)
    const endsAt = rule.endDate
      ? parseLocalDateToTimestamp(rule.endDate)
      : Number.POSITIVE_INFINITY

    if (startsAt === null || endsAt === null) {
      return false
    }

    return now.getTime() >= startsAt && now.getTime() < endsAt
  })

  if (active) {
    return active
  }

  if (sortedRules.length === 0) {
    return undefined
  }

  const firstStart = parseLocalDateToTimestamp(sortedRules[0].startDate)

  if (firstStart !== null && now.getTime() < firstStart) {
    return sortedRules[0]
  }

  return sortedRules[sortedRules.length - 1]
}

function calculateIntervalExpectedDueAt(
  medicationId: string,
  schedule: IntervalSchedule,
  doseEvents: DoseEvent[],
  now: Date,
): Date {
  const latestDose = getLatestValidDoseForMedication(medicationId, doseEvents)

  if (latestDose) {
    const takenAt = toTimestamp(latestDose.timestampGiven)

    if (takenAt === null) {
      return now
    }

    return new Date(
      takenAt + schedule.intervalMinutes * MS_PER_MINUTE,
    )
  }

  return now
}

function calculatePrnExpectedDueAt(
  medicationId: string,
  schedule: PrnSchedule,
  doseEvents: DoseEvent[],
  now: Date,
): Date {
  const latestDose = getLatestValidDoseForMedication(medicationId, doseEvents)

  if (!latestDose) {
    return now
  }

  const takenAt = toTimestamp(latestDose.timestampGiven)

  if (takenAt === null) {
    return now
  }

  return new Date(
    takenAt + schedule.minimumIntervalMinutes * MS_PER_MINUTE,
  )
}

function calculateFixedTimesExpectedDueAt(
  schedule: FixedTimesSchedule,
  now: Date,
): Date {
  const times = [...schedule.timesOfDay]
    .map(parseTimeOfDay)
    .filter((value): value is { hours: number; minutes: number } => value !== null)
    .sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes))

  if (times.length === 0) {
    return now
  }

  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  const todayCandidates = times.map(({ hours, minutes }) => {
    return new Date(year, month, day, hours, minutes, 0, 0)
  })

  const latestToday = [...todayCandidates]
    .reverse()
    .find((candidate) => candidate.getTime() <= now.getTime())

  if (latestToday) {
    return latestToday
  }

  return new Date(
    year,
    month,
    day - 1,
    times[times.length - 1].hours,
    times[times.length - 1].minutes,
    0,
    0,
  )
}

function calculateTaperExpectedDueAt(
  medicationId: string,
  schedule: TaperSchedule,
  doseEvents: DoseEvent[],
  now: Date,
): Date {
  const activeRule = getActiveTaperRule(schedule.rules, now)

  if (!activeRule) {
    return now
  }

  const activeRuleStart = parseLocalDateToTimestamp(activeRule.startDate)

  if (activeRuleStart === null) {
    return now
  }

  const latestDose = getLatestValidDoseForMedication(medicationId, doseEvents)

  if (!latestDose) {
    return getLatestDueFromAnchor(
      fromTimestamp(activeRuleStart),
      activeRule.intervalMinutes,
      now,
    )
  }

  const latestDoseAt = toTimestamp(latestDose.timestampGiven)

  if (latestDoseAt === null) {
    return now
  }

  const reference =
    latestDoseAt > activeRuleStart ? latestDoseAt : activeRuleStart

  return fromTimestamp(reference + activeRule.intervalMinutes * MS_PER_MINUTE)
}

export function calculateExpectedDueTime(
  medication: Medication,
  doseEvents: DoseEvent[],
  now: Date,
): Date {
  switch (medication.schedule.type) {
    case 'interval':
      return calculateIntervalExpectedDueAt(
        medication.id,
        medication.schedule,
        doseEvents,
        now,
      )
    case 'prn':
      return calculatePrnExpectedDueAt(
        medication.id,
        medication.schedule,
        doseEvents,
        now,
      )
    case 'fixed_times':
      return calculateFixedTimesExpectedDueAt(medication.schedule, now)
    case 'taper':
      return calculateTaperExpectedDueAt(
        medication.id,
        medication.schedule,
        doseEvents,
        now,
      )
  }
}

export function calculateNextEligibleTime(
  medication: Medication,
  doseEvents: DoseEvent[],
  now: Date,
): Date {
  return calculateExpectedDueTime(medication, doseEvents, now)
}

function calculateReminderTime(
  expectedDueAt: Date,
  reminderSettings?: ReminderSettings,
): Date | null {
  if (!reminderSettings?.enabled) {
    return null
  }

  const earlyReminderMinutes = reminderSettings.earlyReminderMinutes ?? 0

  return new Date(
    expectedDueAt.getTime() - earlyReminderMinutes * MS_PER_MINUTE,
  )
}

export function calculateMedicationSchedule(
  medication: Medication,
  doseEvents: DoseEvent[],
  now: Date,
): MedicationScheduleResult {
  const expectedDueAt = calculateExpectedDueTime(medication, doseEvents, now)
  const lastGiven = getLatestValidDoseForMedication(medication.id, doseEvents)
  const lastGivenAt = lastGiven
    ? (() => {
        const timestamp = toTimestamp(lastGiven.timestampGiven)
        return timestamp === null ? null : fromTimestamp(timestamp)
      })()
    : null
  const deltaMs = now.getTime() - expectedDueAt.getTime()
  const eligibleNow = deltaMs >= 0

  return {
    medicationId: medication.id,
    lastGivenAt,
    expectedDueAt,
    nextEligibleAt: expectedDueAt,
    eligibleNow,
    tooEarlyByMinutes: eligibleNow
      ? null
      : Math.ceil(Math.abs(deltaMs) / MS_PER_MINUTE),
    overdueByMinutes:
      medication.schedule.type === 'prn'
        ? null
        : deltaMs > 0
          ? Math.floor(deltaMs / MS_PER_MINUTE)
          : null,
    reminderAt: calculateReminderTime(expectedDueAt, medication.reminderSettings),
  }
}

export function getDueStatus(
  nextEligibleAt: Date,
  now: Date,
  dueSoonMinutes = 30,
): DueStatus {
  const deltaMinutes = (nextEligibleAt.getTime() - now.getTime()) / MS_PER_MINUTE

  if (deltaMinutes <= 0) {
    return 'due-now'
  }

  if (deltaMinutes <= dueSoonMinutes) {
    return 'due-soon'
  }

  return 'not-due'
}

export function buildMedicationTiming(
  medication: Medication,
  doseEvents: DoseEvent[],
  now: Date,
  dueSoonMinutes = 30,
): MedicationTiming {
  const schedule = calculateMedicationSchedule(medication, doseEvents, now)

  return {
    medicationId: medication.id,
    nextEligibleAt: schedule.nextEligibleAt,
    dueStatus: getDueStatus(schedule.nextEligibleAt, now, dueSoonMinutes),
    minutesUntilEligible: schedule.tooEarlyByMinutes ?? 0,
  }
}
