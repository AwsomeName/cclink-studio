import type { WorkbenchWindowDropPoint } from '@shared/ipc/workbench-window'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { isDetachedFromMain, useWorkbenchWindowStore } from '../stores/workbench-window-store'
import { flushPendingWorkbenchBrowserWrites } from './workbench-browser-state'
import { flushPendingWorkbenchTabWrites } from './workbench-tab-model'
import { getWorkspaceStateOwnerKey } from './workspace-state'

/** Reuses the same main-owned transaction for menu, command-palette, and drag-out entry points. */
export async function moveBrowserTabToNewWindow(
  tabId: string,
  dropPoint?: WorkbenchWindowDropPoint,
): Promise<void> {
  const tabStore = useTabStore.getState()
  const tab = tabStore.tabs.find((item) => item.id === tabId)
  if (tab?.type !== 'browser') throw new Error('当前仅支持 Browser Tab')
  const placement = useWorkbenchWindowStore.getState().placements[tabId]
  if (isDetachedFromMain(placement)) throw new Error('标签页已在独立窗口')

  const wasActive = tabStore.activeTabId === tabId
  if (wasActive) {
    const fallback = tabStore.tabs.find((item) => item.id !== tabId)
    tabStore.activateTab(fallback?.id ?? null)
  }
  try {
    await flushPendingWorkbenchTabWrites()
    await flushPendingWorkbenchBrowserWrites()
    const result = await window.cclinkStudio.workbenchWindow.moveTabToNewWindow({
      tabId,
      workspaceKey: workspaceRefKey(
        tab.workspaceRef ?? useWorkspaceStore.getState().activeWorkspaceRef,
      ),
      ownerKey: getWorkspaceStateOwnerKey(),
      sourceWindowId: 'main',
      expectedGeneration: placement?.generation ?? 0,
      dropPoint,
    })
    if (!result.success) throw new Error(result.error.message)
    const movedPlacement = result.projection.placements.find(
      (candidate) => candidate.tabId === tabId,
    )
    if (movedPlacement) useWorkbenchWindowStore.getState().applyPlacement(movedPlacement)
  } catch (error) {
    if (wasActive) useTabStore.getState().activateTab(tabId)
    throw error
  }
}

export async function beginBrowserTabDetachDrag(tabId: string): Promise<void> {
  await window.cclinkStudio.workbenchWindow.beginTabDetachDrag({ tabId })
}

export async function cancelBrowserTabDetachDrag(tabId: string): Promise<void> {
  await window.cclinkStudio.workbenchWindow.cancelTabDetachDrag({ tabId })
}

/** Pointer release is only a signal; main owns the native cursor/window-bound arbitration. */
export async function moveBrowserTabFromPointerRelease(tabId: string): Promise<boolean> {
  const dropPoint = await window.cclinkStudio.workbenchWindow.finishTabDetachDrag({ tabId })
  if (!dropPoint) return false
  await moveBrowserTabToNewWindow(tabId, dropPoint)
  return true
}
