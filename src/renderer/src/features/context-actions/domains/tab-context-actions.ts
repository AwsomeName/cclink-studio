import type { Command } from '../../../stores/command-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useFsStore } from '../../../stores/fs-store'
import { useTabStore } from '../../../stores/tab-store'
import { resolveConversationTab } from '../../../utils/conversation-tab'
import { closeTabsWithDraftPolicy } from '../../../utils/close-tab'
import {
  buildHtmlBrowserTabDraft,
  buildHtmlTextTabDraft,
  isHtmlFilePath,
} from '../../../utils/html-files'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function tabIdFromContext(context?: CommandContext): string | null {
  return context?.target?.kind === 'tab' ? context.target.tabId : null
}

export async function renameWorkbenchTab(
  tabId: string,
  requestedTitle: string | null,
): Promise<boolean> {
  const title = requestedTitle?.trim()
  if (!title) return false
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) return false

  if (tab.filePath) {
    return useFsStore.getState().confirmRename(tab.filePath, title)
  }

  useTabStore.getState().updateTabTitle(tabId, title)
  const conversation = resolveConversationTab(tab)
  if (conversation) useAgentStore.getState().renameConversation(conversation.conversationId, title)
  return true
}

function renameTabLabel(context?: CommandContext): string {
  const tabId = tabIdFromContext(context)
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (tab?.filePath) return '重命名文件'
  if (tab && resolveConversationTab(tab)) return '重命名会话'
  return '重命名标签'
}

export function createTabContextCommands(): Command[] {
  return [
    {
      id: 'workbench.renameTab',
      label: '重命名标签',
      contextOnly: true,
      category: 'Tab',
      risk: 'local-write',
      contextLabel: renameTabLabel,
      enabled: (context) => Boolean(tabIdFromContext(context)),
      action: async (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        if (!tabId || !(await renameWorkbenchTab(tabId, context?.inputValue ?? null))) {
          throw new Error(
            tab?.filePath
              ? (useFsStore.getState().operationError ?? '文件重命名失败')
              : '标签页已不存在或名称为空',
          )
        }
      },
    },
    {
      id: 'workbench.openHtmlAlternative',
      label: '切换 HTML 打开方式',
      contextOnly: true,
      category: 'Tab',
      contextLabel: (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        return tab?.type === 'browser' ? '以文本打开' : '用浏览器打开'
      },
      visible: (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        return Boolean(tab && isHtmlFilePath(tab.filePath))
      },
      action: (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        if (!tab?.filePath) throw new Error('HTML 标签页已不存在')
        useTabStore
          .getState()
          .openTab(
            tab.type === 'browser'
              ? buildHtmlTextTabDraft(tab.filePath, tab.title)
              : buildHtmlBrowserTabDraft(tab.filePath, tab.title),
          )
      },
    },
    {
      id: 'workbench.duplicateTab',
      label: '复制此页',
      contextOnly: true,
      category: 'Tab',
      visible: (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        return Boolean(tab && tab.type !== 'terminal' && tab.type !== 'terminal-record')
      },
      enabled: (context) => {
        const tabId = tabIdFromContext(context)
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        const enabled = tab?.type === 'browser' || tab?.type === 'editor'
        return { enabled, reason: enabled ? undefined : '当前标签页不支持复制' }
      },
      action: (context) => {
        const tabId = tabIdFromContext(context)
        if (!tabId) throw new Error('标签页已不存在')
        useTabStore.getState().duplicateTab(tabId)
      },
    },
    {
      id: 'workbench.closeOtherTabs',
      label: '关闭其他 Tab',
      contextOnly: true,
      category: 'Tab',
      enabled: (context) => {
        const tabId = tabIdFromContext(context)
        const tabs = useTabStore.getState().tabs
        return {
          enabled: Boolean(tabId && tabs.some((tab) => tab.id === tabId) && tabs.length > 1),
          reason: '没有其他可关闭的标签页',
        }
      },
      action: async (context) => {
        const tabId = tabIdFromContext(context)
        if (!tabId) throw new Error('标签页已不存在')
        const tabs = useTabStore.getState().tabs
        const ids = tabs
          .filter((tab) => tab.id !== tabId)
          .map((tab) => tab.id)
          .reverse()
        await closeTabsWithDraftPolicy(ids)
      },
    },
    {
      id: 'workbench.closeTabsToRight',
      label: '关闭右侧 Tab',
      contextOnly: true,
      category: 'Tab',
      enabled: (context) => {
        const tabId = tabIdFromContext(context)
        const tabs = useTabStore.getState().tabs
        const index = tabs.findIndex((tab) => tab.id === tabId)
        return {
          enabled: index >= 0 && index < tabs.length - 1,
          reason: index < 0 ? '标签页已关闭' : '右侧没有标签页',
        }
      },
      action: async (context) => {
        const tabId = tabIdFromContext(context)
        const tabs = useTabStore.getState().tabs
        const index = tabs.findIndex((tab) => tab.id === tabId)
        if (index < 0) throw new Error('标签页已不存在')
        await closeTabsWithDraftPolicy(
          tabs
            .slice(index + 1)
            .map((tab) => tab.id)
            .reverse(),
        )
      },
    },
  ]
}

export const tabMenuContributions: MenuContribution[] = [
  {
    id: 'tab.rename',
    targetKinds: ['tab'],
    group: '20-edit',
    order: 10,
    commandId: 'workbench.renameTab',
    icon: '✎',
    inlineInput: {
      ariaLabel: '标签页名称',
      initialValue: (context) => {
        const tabId = tabIdFromContext(context)
        return useTabStore.getState().tabs.find((item) => item.id === tabId)?.title ?? ''
      },
    },
  },
  {
    id: 'tab.html-alternative',
    targetKinds: ['tab'],
    group: '30-open',
    order: 10,
    commandId: 'workbench.openHtmlAlternative',
    icon: '</>',
  },
  {
    id: 'tab.duplicate',
    targetKinds: ['tab'],
    group: '40-copy',
    order: 10,
    commandId: 'workbench.duplicateTab',
    icon: '📋',
  },
  {
    id: 'tab.close',
    targetKinds: ['tab'],
    group: '90-manage',
    order: 10,
    commandId: 'workbench.closeTab',
    icon: '✕',
  },
  {
    id: 'tab.close-others',
    targetKinds: ['tab'],
    group: '90-manage',
    order: 20,
    commandId: 'workbench.closeOtherTabs',
    icon: '✕',
  },
  {
    id: 'tab.close-right',
    targetKinds: ['tab'],
    group: '90-manage',
    order: 30,
    commandId: 'workbench.closeTabsToRight',
    icon: '→',
  },
]
