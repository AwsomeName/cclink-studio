import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'

export function createTabCommands(): Command[] {
  return [
    {
      id: 'workbench.newTab',
      label: '新建 Markdown 草稿',
      shortcut: '⌘ T',
      category: 'Tab',
      action: () =>
        useTabStore
          .getState()
          .openTab({ type: 'editor', title: '未命名.md', icon: '📄', forceNew: true }),
    },
    {
      id: 'browser.newTab',
      label: '新建浏览器页',
      category: '浏览器',
      action: () =>
        useTabStore
          .getState()
          .openTab({ type: 'browser', title: '浏览器', icon: '🌐', forceNew: true }),
    },
    {
      id: 'workbench.closeTab',
      label: '关闭当前 Tab',
      shortcut: '⌘ W',
      category: 'Tab',
      action: () => {
        const { activeTabId, closeTab } = useTabStore.getState()
        if (activeTabId) closeTab(activeTabId)
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
