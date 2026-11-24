import { create } from 'zustand'
export const diaryPages = ['今天', '日记', '计划', '定时整理', '导入历史', 'Git'] as const
export type DiaryPage = (typeof diaryPages)[number]
/** UI navigation only; source, files and task facts remain owned by their existing services. */
export const useDiaryNavigation = create<{ page: DiaryPage; setPage: (page: DiaryPage) => void }>(
  (set) => ({ page: '今天', setPage: (page) => set({ page }) }),
)

/** Where the today page puts its status and actions: the home header row (mockup 24). */
export const useDiaryHeaderSlot = create<{
  slot: HTMLElement | null
  setSlot: (slot: HTMLElement | null) => void
}>((set) => ({ slot: null, setSlot: (slot) => set({ slot }) }))
