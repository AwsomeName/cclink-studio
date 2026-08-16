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

  return input.template
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
