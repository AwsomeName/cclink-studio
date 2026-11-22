import { isMacPlatform } from '@shared/keybindings'
import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openDefaultBrowserTab } from '../../features/web-resources/open-default-browser-tab'
import { closeTabWithDraftPolicy } from '../../utils/close-tab'
import { isDetachedFromMain, useWorkbenchWindowStore } from '../../stores/workbench-window-store'
import { moveBrowserTabToNewWindow } from '../../utils/move-browser-tab-to-window'
import { buildTerminalTabDraft } from '../../utils/terminal-tab'
import { recordTerminalLifecycleEvent } from '../../utils/terminal-lifecycle'

export function createTabCommands(): Command[] {
  const mac = isMacPlatform(typeof navigator === 'undefined' ? '' : navigator.platform)
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
      id: 'desktop.newTab',
      label: '新建远程桌面',
      category: 'Tab',
      action: () =>
        useTabStore
          .getState()
          .openTab({ type: 'remote-desktop', title: '远程桌面', icon: '🖥', forceNew: true }),
    },
    {
      id: 'terminal.newTab',
      label: '新建 Terminal',
      category: 'Terminal',
      action: () => {
        const draft = buildTerminalTabDraft(useWorkspaceStore.getState().activeWorkspaceRef)
        useTabStore.getState().openTab(draft)
        void recordTerminalLifecycleEvent(draft.terminal, 'created', 'Terminal Tab 已创建')
      },
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
        const tab = tabs.find((item) => item.id === tabId)
        return {
          enabled: Boolean(tab && tab.type !== 'workspace-home'),
          reason: tab?.type === 'workspace-home' ? '项目首页始终固定' : '标签页已关闭',
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
        if (!tabId) throw new Error('标签页已关闭')
        await moveBrowserTabToNewWindow(tabId)
      },
    },
    {
      id: 'tab.nextTab',
      label: '下一个 Tab',
      category: 'Tab',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: mac
          ? [{ code: 'BracketRight', modifiers: ['primary', 'alt'] }]
          : [{ code: 'Tab', modifiers: ['primary'] }],
      },
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
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: mac
          ? [{ code: 'BracketLeft', modifiers: ['primary', 'alt'] }]
          : [{ code: 'Tab', modifiers: ['primary', 'shift'] }],
      },
      action: () => {
        const { tabs, activeTabId, activateTab } = useTabStore.getState()
        if (!activeTabId || tabs.length < 2) return
        const idx = tabs.findIndex((tab) => tab.id === activeTabId)
        activateTab(tabs[(idx - 1 + tabs.length) % tabs.length].id)
      },
    },
  ]
}
