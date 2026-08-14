import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { getEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { getTerminalContextSurface } from '../../features/context-actions/terminal-context-surface'
import type { CommandContext } from '../../features/context-actions/context-target'

function resolveFindSurface(context?: CommandContext) {
  if (context?.target?.kind === 'editor') {
    return getEditorContextSurface(context.target.tabId)
  }
  if (context?.target?.kind === 'terminal') {
    return getTerminalContextSurface(context.target.sessionId)
  }
  const tab = useTabStore.getState().getActiveTab()
  if (tab?.type === 'editor') return getEditorContextSurface(tab.id)
  if (tab?.type === 'terminal' && tab.terminal?.sessionId) {
    return getTerminalContextSurface(tab.terminal.sessionId)
  }
  return null
}

export function createWorkbenchCommands(): Command[] {
  return [
    {
      id: 'workbench.find',
      label: '查找当前内容',
      category: '工作台',
      configurable: true,
      shortcutPolicy: {
        scope: 'workbench',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyF', modifiers: ['primary'] }],
      },
      enabled: (context) => ({
        enabled: Boolean(resolveFindSurface(context)),
        reason: '当前内容不支持查找',
      }),
      action: (context) => {
        const surface = resolveFindSurface(context)
        if (!surface) throw new Error('当前内容不支持查找')
        surface.openFind()
      },
    },
  ]
}
