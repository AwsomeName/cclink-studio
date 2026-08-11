import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { useTabStore } from '../stores/tab-store'

export const COMPONENT_SETUP_PAGE_VERSION = 1

export function shouldOpenComponentSetupPage(seenVersion: number): boolean {
  return seenVersion < COMPONENT_SETUP_PAGE_VERSION
}

/** 新安装首次进入工作台时，打开一次组件管理页。 */
export function useComponentSetupOnboarding(workspaceReady: boolean): void {
  const loading = useSettingsStore((state) => state.loading)
  const seenVersion = useSettingsStore((state) => state.settings.componentSetupPageSeenVersion)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const openTab = useTabStore((state) => state.openTab)
  const handled = useRef(false)

  useEffect(() => {
    if (workspaceReady) void loadSettings()
  }, [loadSettings, workspaceReady])

  useEffect(() => {
    if (!workspaceReady || loading || handled.current) return
    if (!shouldOpenComponentSetupPage(seenVersion)) return

    handled.current = true
    openTab({
      type: 'settings',
      title: '组件管理',
      icon: '🧩',
      settingsSection: 'components',
    })
    void updateSettings({ componentSetupPageSeenVersion: COMPONENT_SETUP_PAGE_VERSION })
  }, [loading, openTab, seenVersion, updateSettings, workspaceReady])
}
