import { create } from 'zustand'

export interface DiaryDayEntry {
  path: string
  name: string
}

/**
 * UI projection shared by the sidebar calendar and the 日记 page. The diary files themselves
 * stay the only source of truth; the home page republishes this map after each scan.
 */
export const useDiaryCalendar = create<{
  /** YYYY-MM-DD → diary files of that day (same-day alternates kept). */
  days: Record<string, DiaryDayEntry[]>
  /** Today in the project's timezone, YYYY-MM-DD. */
  today: string
  /** Month shown in the calendar, YYYY-MM. */
  month: string
  /** Day shown on the 日记 page, YYYY-MM-DD. */
  selected: string
  publish: (days: Record<string, DiaryDayEntry[]>, today: string) => void
  setMonth: (month: string) => void
  select: (date: string) => void
}>((set, get) => ({
  days: {},
  today: '',
  month: '',
  selected: '',
  publish: (days, today) =>
    set({
      days,
      today,
      month: get().month || today.slice(0, 7),
      selected: get().selected || today,
    }),
  setMonth: (month) => set({ month }),
  select: (date) => set({ selected: date, month: date.slice(0, 7) }),
}))

export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function weekdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}
