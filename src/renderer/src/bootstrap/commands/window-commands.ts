import type { Command } from '../../stores/command-store'

export function createWindowCommands(): Command[] {
  return [
    {
      id: 'window.reload',
      label: '重新加载窗口',
      category: '窗口',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyR', modifiers: ['primary'] }],
      },
      action: () => window.cclinkStudio.window.reload(),
    },
    {
      id: 'window.toggleDevtools',
      label: '切换开发者工具',
      category: '窗口',
      action: () => window.cclinkStudio.window.toggleDevtools(),
    },
  ]
}
