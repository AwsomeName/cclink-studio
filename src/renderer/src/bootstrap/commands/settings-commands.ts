import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'

export function createSettingsCommands(): Command[] {
  const openSettings = (): void => {
    useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
  }

  return [
    {
      id: 'settings.open',
      label: '打开设置',
      shortcut: '⌘ ,',
      category: '设置',
      action: openSettings,
    },
    {
      id: 'preferences.openKeybindings',
      label: '打开快捷键设置',
      category: '偏好',
      action: () =>
        useTabStore
          .getState()
          .openTab({ type: 'settings', title: '快捷键', icon: '⚙️', settingsSection: 'shortcuts' }),
    },
  ]
}
