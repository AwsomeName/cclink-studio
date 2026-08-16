import type { ScheduledTaskSchedule } from './scheduled-task-types'

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

export function calculateNextRunAt(
  schedule: ScheduledTaskSchedule,
  after: number = Date.now(),
): number | null {
  if (schedule.kind === 'once') return schedule.runAt > after ? schedule.runAt : null

  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number]
  const current = getZonedParts(after, schedule.timezone)
  const calendarStart = Date.UTC(current.year, current.month - 1, current.day)

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = new Date(calendarStart + offset * 86_400_000)
    const weekday = date.getUTCDay()
    if (schedule.kind === 'weekdays' && (weekday === 0 || weekday === 6)) continue
    if (schedule.kind === 'weekly' && !schedule.weekdays.includes(weekday)) continue

    const candidate = zonedDateTimeToEpoch(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour,
        minute,
      },
      schedule.timezone,
    )
    if (candidate !== null && candidate > after) return candidate
  }
  return null
}

function zonedDateTimeToEpoch(parts: ZonedParts, timezone: string): number | null {
  const targetAsUtc = partsToUtc(parts)
  let candidate = targetAsUtc

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = getZonedParts(candidate, timezone)
    const difference = targetAsUtc - partsToUtc(rendered)
    if (difference === 0) return candidate
    candidate += difference
  }

  const rendered = getZonedParts(candidate, timezone)
  if (partsToUtc(rendered) === targetAsUtc) return candidate

  // DST 向前跳跃时目标 wall-clock 不存在。移动到同一当地日期的下一个有效分钟。
  const targetMinute = parts.hour * 60 + parts.minute
  for (
    let probe = targetAsUtc - 14 * 60 * 60 * 1000;
    probe <= targetAsUtc + 14 * 60 * 60 * 1000;
    probe += 60_000
  ) {
    const local = getZonedParts(probe, timezone)
    if (local.year !== parts.year || local.month !== parts.month || local.day !== parts.day)
      continue
    if (local.hour * 60 + local.minute >= targetMinute) return probe
  }
  return null
}

function getZonedParts(epoch: number, timezone: string): ZonedParts {
  let formatter = formatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timezone, formatter)
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(epoch))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  }
}

function partsToUtc(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
}
