import type { UsageGroup, UsagePeriod, UsageTotals } from '@shared/model-usage'
export const DAY = 86400000
export const dateAt = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10)
export const midnight = (date: string) => Date.parse(`${date}T00:00:00+08:00`)
export const nextDate = (date: string, days = 1) => dateAt(midnight(date) + days * DAY)
export const compact = (n: number | null) =>
  n === null
    ? '未提供'
    : n >= 1e9
      ? `${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(2)}M`
        : n >= 1e3
          ? `${(n / 1e3).toFixed(1)}K`
          : n.toLocaleString()
export const total = (row?: UsageTotals) =>
  row
    ? ['input', 'output', 'cacheRead', 'cacheWrite'].reduce(
        (sum, field) => sum + (row.tokens[field as keyof UsageTotals['tokens']].value ?? 0),
        0,
      )
    : 0
export function dates(from: string, to: string) {
  const result: string[] = []
  for (let at = midnight(from); at <= midnight(to); at += DAY) result.push(dateAt(at))
  return result
}
/** No records is zero only when the complete day was observed on this installation. */
export function dayCoverage(
  date: string,
  periods: UsagePeriod[],
  originId: string,
): 'observed' | 'partial' | 'unrecorded' {
  const from = midnight(date),
    to = from + DAY
  const ranges = periods
    .filter((p) => p.originId === originId && p.state === 'recording')
    .map((p) => [Math.max(from, Date.parse(p.from)), Math.min(to, Date.parse(p.to))])
    .filter(([a, b]) => a < b)
    .sort((a, b) => a[0] - b[0])
  let end = from,
    covered = 0
  for (const [a, b] of ranges) {
    covered += Math.max(0, b - Math.max(a, end))
    end = Math.max(end, b)
  }
  const degraded = periods.some(
    (p) =>
      p.originId === originId &&
      p.state === 'degraded' &&
      Date.parse(p.from) < to &&
      Date.parse(p.to) > from,
  )
  return covered >= DAY && !degraded ? 'observed' : covered > 0 ? 'partial' : 'unrecorded'
}
export function periodKey(date: string, granularity: 'day' | 'week' | 'month') {
  if (granularity === 'month') return date.slice(0, 7)
  if (granularity === 'week') {
    const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay()
    return nextDate(date, -((weekday + 6) % 7))
  }
  return date
}
export function activityStreak(days: UsageGroup[], endDate: string) {
  const active = new Set(days.filter((day) => day.calls > 0).map((day) => day.name))
  let n = 0
  for (let date = endDate; active.has(date); date = nextDate(date, -1)) n++
  return n
}
