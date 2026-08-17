import { create } from 'zustand'

export type WorkspaceOpenStep = 'sources' | 'remote'

interface WorkspaceOpenState {
  open: boolean
  step: WorkspaceOpenStep
  show: (step?: WorkspaceOpenStep) => void
  showRemote: () => void
  showSources: () => void
  close: () => void
}

/**
 * 只拥有统一打开入口的瞬时 UI 状态；活动工作空间仍由 workspace-store 唯一持有。
 */
export const useWorkspaceOpenStore = create<WorkspaceOpenState>((set) => ({
  open: false,
  step: 'sources',
  show: (step = 'sources') => set({ open: true, step }),
  showRemote: () => set({ open: true, step: 'remote' }),
  showSources: () => set({ step: 'sources' }),
  close: () => set({ open: false, step: 'sources' }),
}))
