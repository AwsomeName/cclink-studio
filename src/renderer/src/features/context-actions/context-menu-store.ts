import { create } from 'zustand'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { ContextTarget } from './context-target'

export type ContextMenuCloseReason =
  | 'execute'
  | 'escape'
  | 'outside'
  | 'blur'
  | 'workspace-switch'
  | 'target-invalidated'
  | 'native-browser-menu'

export interface ShowContextMenuInput {
  target: ContextTarget
  x: number
  y: number
  focusReturn?: HTMLElement | null
  browserPreviewDataUrl?: string | null
}

interface ContextMenuState {
  open: boolean
  menuId: number
  x: number
  y: number
  target: ContextTarget | null
  focusReturn: HTMLElement | null
  browserPreviewDataUrl: string | null
  workspaceKeyAtOpen: string | null
  editingContributionId: string | null
  inputValue: string
  show: (input: ShowContextMenuInput) => void
  hide: (reason?: ContextMenuCloseReason) => void
  beginInlineEdit: (contributionId: string, initialValue: string) => void
  setInputValue: (value: string) => void
  cancelInlineEdit: () => void
  clearBrowserPreview: () => void
}

let nextMenuId = 1

export const useContextMenuStore = create<ContextMenuState>((set, get) => ({
  open: false,
  menuId: 0,
  x: 0,
  y: 0,
  target: null,
  focusReturn: null,
  browserPreviewDataUrl: null,
  workspaceKeyAtOpen: null,
  editingContributionId: null,
  inputValue: '',

  show: ({ target, x, y, focusReturn = null, browserPreviewDataUrl = null }) =>
    set({
      open: true,
      menuId: nextMenuId++,
      x,
      y,
      target,
      focusReturn,
      browserPreviewDataUrl,
      workspaceKeyAtOpen: workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef),
      editingContributionId: null,
      inputValue: '',
    }),

  hide: () => {
    const focusReturn = get().focusReturn
    set({
      open: false,
      x: 0,
      y: 0,
      target: null,
      focusReturn: null,
      editingContributionId: null,
      inputValue: '',
    })
    if (focusReturn?.isConnected) requestAnimationFrame(() => focusReturn.focus())
  },

  beginInlineEdit: (editingContributionId, inputValue) =>
    set({ editingContributionId, inputValue }),
  setInputValue: (inputValue) => set({ inputValue }),
  cancelInlineEdit: () => set({ editingContributionId: null, inputValue: '' }),
  clearBrowserPreview: () => set({ browserPreviewDataUrl: null }),
}))
