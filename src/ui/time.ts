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
