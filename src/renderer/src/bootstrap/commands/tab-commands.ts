import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openDefaultBrowserTab } from '../../features/web-resources/open-default-browser-tab'
import { closeTabWithDraftPolicy } from '../../utils/close-tab'
import { workspaceRefKey } from '@shared/workspace-ref'
import { isDetachedFromMain, useWorkbenchWindowStore } from '../../stores/workbench-window-store'
import { flushPendingWorkbenchTabWrites } from '../../utils/workbench-tab-model'
import { flushPendingWorkbenchBrowserWrites } from '../../utils/workbench-browser-state'
import { getWorkspaceStateOwnerKey } from '../../utils/workspace-state'

export function createTabCommands(): Command[] {
  return [
    {
      id: 'workbench.newTab',
      label: '新建 Markdown 草稿',
      category: 'Tab',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyT', modifiers: ['primary'] }],
      },
      action: () =>
        useTabStore
          .getState()
          .openTab({ type: 'editor', title: '未命名.md', icon: '📄', forceNew: true }),
    },
    {
      id: 'browser.newTab',
      label: '新建浏览器页',
      category: '浏览器',
      action: () => openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef),
    },
    {
      id: 'workbench.closeTab',
      label: '关闭当前 Tab',
      category: 'Tab',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyW', modifiers: ['primary'] }],
      },
      contextLabel: (context) => {
        const tabId = context.target?.kind === 'tab' ? context.target.tabId : null
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        return tab?.type === 'terminal' || tab?.type === 'terminal-record'
          ? '关闭 Terminal'
          : context.target?.kind === 'tab'
            ? '关闭'
            : '关闭当前 Tab'
      },
      enabled: (context) => {
        const { activeTabId, tabs } = useTabStore.getState()
        const tabId = context.target?.kind === 'tab' ? context.target.tabId : activeTabId
        return {
          enabled: Boolean(tabId && tabs.some((tab) => tab.id === tabId)),
          reason: '标签页已关闭',
        }
      },
      action: (context) => {
        const { activeTabId } = useTabStore.getState()
        const tabId = context?.target?.kind === 'tab' ? context.target.tabId : activeTabId
        if (tabId) return closeTabWithDraftPolicy(tabId)
      },
    },
    {
      id: 'workbench.moveTabToNewWindow',
      label: '移至新窗口',
      category: 'Tab',
      enabled: (context) => {
        const state = useTabStore.getState()
        const tabId = context.target?.kind === 'tab' ? context.target.tabId : state.activeTabId
        const tab = state.tabs.find((item) => item.id === tabId)
        const placement = tabId ? useWorkbenchWindowStore.getState().placements[tabId] : undefined
        return {
          enabled: Boolean(tab?.type === 'browser' && !isDetachedFromMain(placement)),
          reason: tab?.type === 'browser' ? '标签页已在独立窗口' : '当前仅支持 Browser Tab',
        }
      },
      action: async (context) => {
        const tabStore = useTabStore.getState()
        const tabId = context?.target?.kind === 'tab' ? context.target.tabId : tabStore.activeTabId
        const tab = tabStore.tabs.find((item) => item.id === tabId)
        if (!tabId || tab?.type !== 'browser') throw new Error('当前仅支持 Browser Tab')
        const placement = useWorkbenchWindowStore.getState().placements[tabId]
        if (isDetachedFromMain(placement)) throw new Error('标签页已在独立窗口')

        const wasActive = tabStore.activeTabId === tabId
        if (wasActive) {
          const fallback = tabStore.tabs.find((item) => item.id !== tabId)
          tabStore.activateTab(fallback?.id ?? null)
        }
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
        })
        if (!result.success) {
          if (wasActive) useTabStore.getState().activateTab(tabId)
          throw new Error(result.error.message)
        }
        const movedPlacement = result.projection.placements.find(
          (candidate) => candidate.tabId === tabId,
        )
        if (movedPlacement) {
          useWorkbenchWindowStore.getState().applyPlacement(movedPlacement)
        }
      },
    },
    {
      id: 'tab.nextTab',
      label: '下一个 Tab',
      category: 'Tab',
      action: () => {
        const { tabs, activeTabId, activateTab } = useTabStore.getState()
        if (!activeTabId || tabs.length < 2) return
        const idx = tabs.findIndex((tab) => tab.id === activeTabId)
        activateTab(tabs[(idx + 1) % tabs.length].id)
      },
    },
    {
      id: 'tab.prevTab',
      label: '上一个 Tab',
      category: 'Tab',
      action: () => {
        const { tabs, activeTabId, activateTab } = useTabStore.getState()
        if (!activeTabId || tabs.length < 2) return
        const idx = tabs.findIndex((tab) => tab.id === activeTabId)
        activateTab(tabs[(idx - 1 + tabs.length) % tabs.length].id)
      },
    },
  ]
}
