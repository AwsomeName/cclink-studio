import { create } from 'zustand'

/**
 * UI projection of which days have a tech daily report, for the sidebar calendar and the
 * 科技日报 page. The report files and TechDailyService stay the source of truth.
 */
export const useTechDailyCalendar = create<{
  workspacePath: string
  /** YYYY-MM-DD → absolute report path. */
  days: Record<string, string>
  today: string
  month: string
  selected: string
  /** Bumps when a run finishes, so the open report remounts with the new file. */
  revision: number
  load: (workspacePath: string, month?: string) => Promise<void>
  setMonth: (month: string) => void
  select: (date: string) => void
  refresh: () => Promise<void>
}>((set, get) => ({
  workspacePath: '',
  days: {},
  today: '',
  month: '',
  selected: '',
  revision: 0,
  load: async (workspacePath, month) => {
    const target = month || get().month || new Date().toISOString().slice(0, 7)
    const result = await window.cclinkStudio.techDaily.listMonth({ workspacePath, month: target })
    if (!result.success) return
    const state = get()
    // Keep other months' days that were loaded before (prev/next navigation across months).
    const days = Object.fromEntries(
      Object.entries(state.workspacePath === workspacePath ? state.days : {}).filter(
        ([day]) => !day.startsWith(target),
      ),
    )
    set({
      workspacePath,
      days: { ...days, ...result.data.days },
      today: result.data.today,
      month: month || state.month || result.data.today.slice(0, 7),
      selected:
        state.workspacePath === workspacePath && state.selected
          ? state.selected
          : result.data.today,
    })
  },
  setMonth: (month) => {
    set({ month })
    const { workspacePath } = get()
    if (workspacePath) void get().load(workspacePath, month)
  },
  select: (date) => {
    const changedMonth = date.slice(0, 7) !== get().month
    set({ selected: date, month: date.slice(0, 7) })
    const { workspacePath } = get()
    if (changedMonth && workspacePath) void get().load(workspacePath, date.slice(0, 7))
  },
  refresh: async () => {
    const { workspacePath, month } = get()
    if (workspacePath) await get().load(workspacePath, month)
    set({ revision: get().revision + 1 })
  },
}))
