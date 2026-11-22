const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

interface ScheduledTaskFileNameInput {
  template: string
  timestamp: number
  timezone: string
  taskId: string
  runId: string
}

export function renderScheduledTaskFileName(input: ScheduledTaskFileNameInput): string {
  const parts = getZonedDateTimeParts(input.timestamp, input.timezone)
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const monthDay = `${parts.month}${parts.day}`
  const time = `${parts.hour}${parts.minute}`
  const weekdayIndex = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  ).getUTCDay()

  return renderPlanTokens(input.template, parts)
    .replaceAll('{taskId}', input.taskId)
    .replaceAll('{runId}', input.runId)
    .replaceAll('{date}', date)
    .replaceAll('{monthDay}', monthDay)
    .replaceAll('{weekday}', WEEKDAY_LABELS[weekdayIndex])
    .replaceAll('{time}', time)
}

function getZonedDateTimeParts(
  timestamp: number,
  timezone: string,
): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  }
}

/** Only date components are substituted; callers still validate canonical output boundaries. */
export function renderScheduledTaskDirectory(
  template: string,
  timestamp: number,
  timezone: string,
): string {
  const parts = getZonedDateTimeParts(timestamp, timezone)
  return renderPlanTokens(template, parts)
    .replaceAll('{year}', parts.year)
    .replaceAll('{month}', parts.month)
    .replaceAll('{day}', parts.day)
}

export function isoWeek(date: Date): { year: number; week: string } {
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  thursday.setUTCHours(0, 0, 0, 0)
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)
  return { year, week: String(week).padStart(2, '0') }
}

function renderPlanTokens(
  template: string,
  parts: Record<'year' | 'month' | 'day', string>,
): string {
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const currentWeek = isoWeek(new Date(Date.UTC(year, month - 1, day)))
  const nextWeek = isoWeek(new Date(Date.UTC(year, month - 1, day + 7)))
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)
  return template
    .replaceAll('{isoYear}', String(currentWeek.year))
    .replaceAll('{isoWeek}', currentWeek.week)
    .replaceAll('{nextWeekYear}', String(nextWeek.year))
    .replaceAll('{nextWeek}', nextWeek.week)
    .replaceAll('{nextMonthYear}', nextMonth.slice(0, 4))
    .replaceAll('{nextMonth}', nextMonth)
    .replaceAll('{nextYear}', String(year + 1))
}
