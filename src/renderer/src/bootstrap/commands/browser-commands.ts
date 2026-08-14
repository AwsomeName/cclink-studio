import type { Command } from '../../stores/command-store'
import { useBrowserStore } from '../../stores/browser-store'
import { useTabStore } from '../../stores/tab-store'

export function createBrowserCommands(): Command[] {
  return [
    {
      id: 'browser.navigate',
      label: '聚焦地址栏',
      category: '浏览器',
      configurable: true,
      shortcutPolicy: {
        scope: 'browser',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyL', modifiers: ['primary'] }],
      },
      action: () => {
        const input = document.querySelector('.url-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
      },
    },
    {
      id: 'browser.zoomIn',
      label: '放大浏览器',
      category: '浏览器',
      configurable: true,
      shortcutPolicy: {
        scope: 'browser',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'Equal', modifiers: ['primary'] }],
      },
      action: () => {
        const tab = useTabStore.getState().getActiveTab()
        if (tab?.type === 'browser') window.cclinkStudio.browser.zoomIn(tab.id)
      },
    },
    {
      id: 'browser.zoomOut',
      label: '缩小浏览器',
      category: '浏览器',
      configurable: true,
      shortcutPolicy: {
        scope: 'browser',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'Minus', modifiers: ['primary'] }],
      },
      action: () => {
        const tab = useTabStore.getState().getActiveTab()
        if (tab?.type === 'browser') window.cclinkStudio.browser.zoomOut(tab.id)
      },
    },
    {
      id: 'browser.toggleDeviceMode',
      label: '切换设备模式（桌面/移动）',
      category: '浏览器',
      action: () => {
        const tab = useTabStore.getState().getActiveTab()
        if (tab?.type !== 'browser') return
        const viewMode = useBrowserStore.getState().tabs[tab.id]?.viewMode
        if (viewMode)
          window.cclinkStudio.browser.setDeviceMode(
            tab.id,
            viewMode === 'desktop' ? 'mobile' : 'desktop',
          )
      },
    },
  ]
}
