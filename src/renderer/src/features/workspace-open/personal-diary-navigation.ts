import { create } from 'zustand'
export const diaryPages = ['今天', '日记', '计划', '定时整理', '资料接入', 'Git'] as const
export type DiaryPage = (typeof diaryPages)[number]
/** UI navigation only; source, files and task facts remain owned by their existing services. */
export const useDiaryNavigation = create<{ page: DiaryPage; setPage: (page: DiaryPage) => void }>(
  (set) => ({ page: '今天', setPage: (page) => set({ page }) }),
)
