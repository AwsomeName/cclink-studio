import { create } from 'zustand'

/**
 * 顶栏独立页面的唯一状态所有者。
 *
 * 工作台（项目条 + Tab）、Owner 和 Studio 设置三者互斥地占据主区域；
 * Studio 设置是全局能力，不再作为项目里的 Tab 存在。项目设置（workspace）仍是项目 Tab。
 */
export type AppPage = 'workbench' | 'owner' | 'settings'

interface AppPageState {
  page: AppPage
  /** 打开 Studio 设置时要定位的分区；undefined 表示保持当前分区。 */
  settingsSection?: string
  /** 每次请求打开设置时递增，让同一分区的重复请求也能重新定位。 */
  settingsRequest: number
  openSettings: (section?: string) => void
  toggleOwner: () => void
  showWorkbench: () => void
}

export const useAppPageStore = create<AppPageState>((set) => ({
  page: 'workbench',
  settingsSection: undefined,
  settingsRequest: 0,
  openSettings: (section) =>
    set((state) => ({
      page: 'settings',
      settingsSection: section ?? (state.page === 'settings' ? state.settingsSection : undefined),
      settingsRequest: state.settingsRequest + 1,
    })),
  toggleOwner: () => set((state) => ({ page: state.page === 'owner' ? 'workbench' : 'owner' })),
  showWorkbench: () => set((state) => (state.page === 'workbench' ? state : { page: 'workbench' })),
}))
