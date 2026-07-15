import { create } from 'zustand'

/**
 * update-store — 自动更新状态（半自动方案：检查 + 通知 + 下载 dmg）
 *
 * 主进程周期性检查配置更新源上的 latest-mac.yml，发现新版本时推送，
 * App.tsx 监听后写入本 store，StatusBar 据此显示更新提示。
 */
interface UpdateState {
  /** 是否有可用更新 */
  hasUpdate: boolean
  /** 最新版本号 */
  latestVersion: string
  /** 是否正在下载 */
  downloading: boolean
  /** 收到主进程的更新通知 */
  setUpdate: (version: string) => void
  /** 清除提示（下载后或忽略） */
  clear: () => void
  /** 设置下载中状态 */
  setDownloading: (downloading: boolean) => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  latestVersion: '',
  downloading: false,
  setUpdate: (version) => set({ hasUpdate: true, latestVersion: version }),
  clear: () => set({ hasUpdate: false, latestVersion: '', downloading: false }),
  setDownloading: (downloading) => set({ downloading }),
}))
