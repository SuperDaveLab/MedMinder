export type DurationUnit = 'minutes' | 'hours' | 'days'

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

const durationUnitMinutes: Record<DurationUnit, number> = {
  minutes: 1,
  hours: MINUTES_PER_HOUR,
  days: MINUTES_PER_DAY,
}

function buildDurationParts(totalMinutes: number): Array<{ value: number; shortLabel: string; longLabel: string }> {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  const days = Math.floor(safeMinutes / MINUTES_PER_DAY)
  const hours = Math.floor((safeMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR)
  const minutes = safeMinutes % MINUTES_PER_HOUR

  return [
    { value: days, shortLabel: 'd', longLabel: 'day' },
    { value: hours, shortLabel: 'h', longLabel: 'hour' },
    { value: minutes, shortLabel: 'm', longLabel: 'minute' },
  ].filter((part) => part.value > 0)
}

export function durationValueToMinutes(value: number, unit: DurationUnit): number {
  return Math.round(value * durationUnitMinutes[unit])
}

export function chooseDurationUnit(totalMinutes: number): DurationUnit {
  if (totalMinutes > 0 && totalMinutes % MINUTES_PER_DAY === 0) {
    return 'days'
  }

  if (totalMinutes > 0 && totalMinutes % MINUTES_PER_HOUR === 0) {
    return 'hours'
  }

  return 'minutes'
}

export function durationMinutesToValue(totalMinutes: number, unit: DurationUnit = chooseDurationUnit(totalMinutes)): string {
  const convertedValue = totalMinutes / durationUnitMinutes[unit]

  if (Number.isInteger(convertedValue)) {
    return String(convertedValue)
  }

  return String(Number.parseFloat(convertedValue.toFixed(2)))
}

export function formatDurationMinutesCompact(totalMinutes: number): string {
  const parts = buildDurationParts(totalMinutes)

  if (parts.length === 0) {
    return '0m'
  }

  return parts.map((part) => `${part.value}${part.shortLabel}`).join(' ')
}

export function formatDurationMinutesLong(totalMinutes: number): string {
  const parts = buildDurationParts(totalMinutes)

  if (parts.length === 0) {
    return '0 minutes'
  }

  return parts
    .map((part) => `${part.value} ${part.longLabel}${part.value === 1 ? '' : 's'}`)
    .join(' ')
}

export function formatAbsoluteDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return 'Invalid date'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value)
}

export function formatRelativeTime(targetDate: Date, now: Date): string {
  if (Number.isNaN(targetDate.getTime()) || Number.isNaN(now.getTime())) {
    return 'invalid time'
  }

  const diffMs = now.getTime() - targetDate.getTime()
  const diffMinutes = Math.round(Math.abs(diffMs) / 60_000)

  if (diffMinutes < 1) {
    return 'just now'
  }

  if (diffMinutes < 60) {
    return diffMs >= 0 ? `${diffMinutes}m ago` : `in ${diffMinutes}m`
  }

  const diffHours = Math.round(diffMinutes / 60)

  if (diffHours < 24) {
    return diffMs >= 0 ? `${diffHours}h ago` : `in ${diffHours}h`
  }

  const diffDays = Math.round(diffHours / 24)

  return diffMs >= 0 ? `${diffDays}d ago` : `in ${diffDays}d`
}
