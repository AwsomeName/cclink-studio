import type { Command } from '../../stores/command-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useThemeStore } from '../../stores/theme-store'
import {
  APP_ZOOM_LEVEL_MAX,
  APP_ZOOM_LEVEL_MIN,
  APP_ZOOM_LEVEL_STEP,
} from '@shared/settings-constants'

interface ViewCommandDeps {
  toggleSidebar: () => void
  toggleAgentPanel: () => void
  focusAgentPanel: () => void
  resetAgentLayout: () => void
}

function clampAppZoomLevel(level: number): number {
  return Math.min(APP_ZOOM_LEVEL_MAX, Math.max(APP_ZOOM_LEVEL_MIN, level))
}

async function updateAppZoomLevel(level: number): Promise<void> {
  const store = useSettingsStore.getState()
  const success = await store.updateSettings({ appZoomLevel: clampAppZoomLevel(level) })
  if (!success) throw new Error(useSettingsStore.getState().error ?? '应用缩放更新失败')
}

export function createViewCommands(deps: ViewCommandDeps): Command[] {
  return [
    {
      id: 'workbench.toggleSidebar',
      label: '切换侧栏',
      category: '视图',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'deny',
        defaultBindings: [{ code: 'KeyB', modifiers: ['primary'] }],
      },
      action: deps.toggleSidebar,
    },
    {
      id: 'workbench.toggleAgentPanel',
      label: '切换 Agent 面板',
      category: '视图',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyJ', modifiers: ['primary'] }],
      },
      action: deps.toggleAgentPanel,
    },
    {
      id: 'workbench.focusAgentPanel',
      label: '专注 Agent 对话',
      category: '视图',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyJ', modifiers: ['primary', 'shift'] }],
      },
      action: deps.focusAgentPanel,
    },
    {
      id: 'workbench.resetAgentLayout',
      label: '重置 Agent 布局',
      category: '视图',
      action: deps.resetAgentLayout,
    },
    {
      id: 'view.zoomIn',
      label: '放大界面',
      category: '视图',
      action: () =>
        updateAppZoomLevel(useSettingsStore.getState().settings.appZoomLevel + APP_ZOOM_LEVEL_STEP),
    },
    {
      id: 'view.zoomOut',
      label: '缩小界面',
      category: '视图',
      action: () =>
        updateAppZoomLevel(useSettingsStore.getState().settings.appZoomLevel - APP_ZOOM_LEVEL_STEP),
    },
    {
      id: 'view.zoomReset',
      label: '重置界面缩放',
      category: '视图',
      action: () => updateAppZoomLevel(0),
    },
    {
      id: 'view.toggleFullscreen',
      label: '切换全屏',
      category: '视图',
      action: () => window.cclinkStudio.window.toggleFullscreen(),
    },
    {
      id: 'theme.switchTheme',
      label: '切换主题（深色/浅色）',
      category: '主题',
      action: () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark'
        const next = cur === 'dark' ? 'light' : 'dark'
        document.documentElement.setAttribute('data-theme', next)
        useThemeStore.getState().setTheme(next)
      },
    },
  ]
}
