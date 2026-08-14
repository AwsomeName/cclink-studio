import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { getEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { getTerminalContextSurface } from '../../features/context-actions/terminal-context-surface'
import type { CommandContext } from '../../features/context-actions/context-target'
import { useCommandStore } from '../../stores/command-store'
import { getRemoteFileDraft } from '../../utils/remote-file-draft-registry'
import { useBrowserFindStore } from '../../features/browser/browser-find-store'
import { getMediaProjectDraft } from '../../features/media-production/media-project-draft-registry'

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
  if (tab?.type === 'browser') {
    return {
      openFind: () => useBrowserFindStore.getState().open(tab.id),
    }
  }
  return null
}

export function createWorkbenchCommands(): Command[] {
  return [
    {
      id: 'workbench.showCommands',
      label: '显示命令面板',
      category: '工作台',
      configurable: true,
      shortcutPolicy: {
        scope: 'global',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyP', modifiers: ['primary', 'shift'] }],
      },
      action: () => useCommandStore.getState().togglePalette(),
    },
    {
      id: 'workbench.save',
      label: '保存当前文件',
      category: '文件',
      configurable: true,
      shortcutPolicy: {
        scope: 'workbench',
        inputPolicy: 'allow',
        defaultBindings: [{ code: 'KeyS', modifiers: ['primary'] }],
      },
      enabled: () => {
        const tab = useTabStore.getState().getActiveTab()
        const enabled =
          (tab?.type === 'editor' && Boolean(getEditorContextSurface(tab.id)?.save)) ||
          (tab?.type === 'remote-file' && Boolean(getRemoteFileDraft(tab.id))) ||
          (tab?.type === 'media-production' && Boolean(getMediaProjectDraft(tab.id)))
        return { enabled, reason: '当前内容不支持保存' }
      },
      action: async () => {
        const tab = useTabStore.getState().getActiveTab()
        if (tab?.type === 'editor') {
          const save = getEditorContextSurface(tab.id)?.save
          if (!save) throw new Error('当前编辑器尚未就绪')
          await save()
          return
        }
        if (tab?.type === 'remote-file') {
          const draft = getRemoteFileDraft(tab.id)
          if (!draft) throw new Error('当前远程文件尚未就绪')
          await draft.save()
          return
        }
        if (tab?.type === 'media-production') {
          const draft = getMediaProjectDraft(tab.id)
          if (!draft) throw new Error('当前宣发视频工程尚未就绪')
          await draft.save()
          return
        }
        throw new Error('当前内容不支持保存')
      },
    },
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
