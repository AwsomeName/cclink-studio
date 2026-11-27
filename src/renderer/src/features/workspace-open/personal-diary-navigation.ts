import { create } from 'zustand'
export const diaryPages = [
  '今天',
  '日记',
  '科技日报',
  '计划',
  '事务',
  '定时整理',
  '财务',
  '健康',
  '导入历史',
  'Git',
] as const
export type DiaryPage = (typeof diaryPages)[number]
/** UI navigation only; source, files and task facts remain owned by their existing services. */
export const useDiaryNavigation = create<{ page: DiaryPage; setPage: (page: DiaryPage) => void }>(
  (set) => ({ page: '今天', setPage: (page) => set({ page }) }),
)
