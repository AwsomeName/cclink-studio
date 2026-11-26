import { useBrowserStore } from '../../../stores/browser-store'
import { useCommandStore } from '../../../stores/command-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useEditorStore } from '../../../stores/editor-store'
import { contentPresentation } from '../../../utils/content-presentation'
import { runEditorSaveGuard } from '../../editor-save-guard'
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
import {
  desktopIdentity,
  identityColorFor,
  nextIdentityColor,
  normalizeTabShortName,
} from '../../tab-identity/tab-identity'
import type { MenuContribution } from '../menu-contribution-registry'

function tabIdFromContext(context?: CommandContext): string | null {
  return context?.target?.kind === 'tab' ? context.target.tabId : null
}

function isLocalFileBackedTab(context: CommandContext): boolean {
  const tabId = tabIdFromContext(context)
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  return Boolean(tab?.filePath && tab.type !== 'remote-file' && !tab.remoteFile)
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
  if (conversation?.kind === 'local-agent') {
    useAgentStore.getState().renameConversation(conversation.conversationId, title)
  }
  return true
}

function desktopTabFromContext(context?: CommandContext) {
  const tabId = tabIdFromContext(context)
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  return tab?.type === 'remote-desktop' ? tab : null
}

function currentDesktopIdentity(context?: CommandContext) {
  const tab = desktopTabFromContext(context)
  if (!tab) return null
  return desktopIdentity({
    tabId: tab.id,
    title: tab.title,
    target: tab.desktopTarget,
    override: tab.desktopIdentity,
  })
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
    ...(['markdown', 'source', 'html'] as const).map(
      (mode): Command => ({
        id: `workbench.openAs.${mode}`,
        label: { markdown: '以 Markdown 正文打开', source: '以源码打开', html: '用浏览器预览' }[
          mode
        ],
        category: '打开方式',
        enabled: (context) => {
          const tab = useTabStore
            .getState()
            .tabs.find(
              (item) =>
                item.id === (tabIdFromContext(context) ?? useTabStore.getState().activeTabId),
            )
          return Boolean(
            tab?.filePath && contentPresentation(tab)?.options.some((option) => option.id === mode),
          )
        },
        action: async (context) => {
          const tab = useTabStore
            .getState()
            .tabs.find(
              (item) =>
                item.id === (tabIdFromContext(context) ?? useTabStore.getState().activeTabId),
            )
          if (
            !tab?.filePath ||
            !contentPresentation(tab)?.options.some((option) => option.id === mode)
          )
            throw new Error('当前内容不支持此打开方式')
          // Inspect the live rich document before unmounting; retain the same EditorStore buffer.
          if (tab.type === 'editor') await runEditorSaveGuard(tab.filePath)
          const stillCurrent = (): boolean =>
            useTabStore.getState().tabs.some((item) => item.id === tab.id) &&
            (!tab.workspaceRef ||
              workspaceRefKey(tab.workspaceRef) ===
                workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef))
          if (!stillCurrent()) throw new Error('文件所属项目已切换')
          if (isHtmlFilePath(tab.filePath)) {
            if (mode === 'html' && useEditorStore.getState().files[tab.filePath]?.dirty) {
              const result = await useEditorStore.getState().saveFile(tab.filePath)
              if (result !== 'saved' || useEditorStore.getState().files[tab.filePath]?.dirty)
                throw new Error('请先处理未保存内容或文件冲突，再预览网页')
            }
            if (!stillCurrent()) throw new Error('文件所属项目已切换')
            const preview =
              mode === 'html'
                ? useTabStore
                    .getState()
                    .tabs.find(
                      (item) =>
                        item.type === 'browser' &&
                        item.filePath === tab.filePath &&
                        item.workspaceRef &&
                        tab.workspaceRef &&
                        workspaceRefKey(item.workspaceRef) === workspaceRefKey(tab.workspaceRef),
                    )
                : undefined
            useTabStore.getState().openTab({
              ...(mode === 'html'
                ? buildHtmlBrowserTabDraft(tab.filePath, tab.title)
                : buildHtmlTextTabDraft(tab.filePath, tab.title)),
              workspaceRef: tab.workspaceRef,
            })
            if (preview && useBrowserStore.getState().tabs[preview.id])
              await window.cclinkStudio.browser.reload(preview.id)
          } else if (mode !== 'html') useTabStore.getState().setEditorPresentation(tab.id, mode)
        },
      }),
    ),
    {
      id: 'workbench.toggleTabPinned',
      label: '固定标签',
      category: 'Tab',
      contextLabel: (context) => {
        const tabId = tabIdFromContext(context) ?? useTabStore.getState().activeTabId
        return useTabStore.getState().tabs.find((tab) => tab.id === tabId)?.pinned
          ? '解除固定'
          : '固定标签'
      },
      enabled: (context) => {
        const tabId = tabIdFromContext(context) ?? useTabStore.getState().activeTabId
        return useTabStore
          .getState()
          .tabs.some((tab) => tab.id === tabId && tab.type !== 'workspace-home')
      },
      action: (context) => {
        const state = useTabStore.getState()
        const tabId = tabIdFromContext(context) ?? state.activeTabId
        const tab = state.tabs.find((item) => item.id === tabId)
        if (!tab) throw new Error('标签页已不存在')
        state.setTabPinned(tab.id, !tab.pinned)
      },
    },
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
      id: 'workbench.setDesktopShortName',
      label: '改简称',
      contextOnly: true,
      category: 'Tab',
      risk: 'local-write',
      visible: (context) => Boolean(desktopTabFromContext(context)),
      action: (context) => {
        const tab = desktopTabFromContext(context)
        if (!tab) throw new Error('远程桌面标签已不存在')
        const shortName = normalizeTabShortName(context?.inputValue ?? '')
        if (!shortName) throw new Error('简称不能为空')
        useTabStore.getState().setDesktopIdentity(tab.id, { ...tab.desktopIdentity, shortName })
      },
    },
    {
      id: 'workbench.cycleDesktopColor',
      label: '换一个颜色',
      contextOnly: true,
      category: 'Tab',
      risk: 'local-write',
      visible: (context) => Boolean(desktopTabFromContext(context)),
      action: (context) => {
        const tab = desktopTabFromContext(context)
        if (!tab) throw new Error('远程桌面标签已不存在')
        const current =
          currentDesktopIdentity(context)?.color ??
          identityColorFor(tab.desktopTarget?.deviceId ?? tab.desktopTarget?.host ?? tab.id)
        useTabStore
          .getState()
          .setDesktopIdentity(tab.id, { ...tab.desktopIdentity, color: nextIdentityColor(current) })
      },
    },
    {
      id: 'workbench.resetDesktopIdentity',
      label: '恢复默认简称和颜色',
      contextOnly: true,
      category: 'Tab',
      risk: 'local-write',
      visible: (context) => Boolean(desktopTabFromContext(context)?.desktopIdentity),
      action: (context) => {
        const tab = desktopTabFromContext(context)
        if (!tab) throw new Error('远程桌面标签已不存在')
        useTabStore.getState().setDesktopIdentity(tab.id, null)
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
      action: async (context) => {
        const tab = useTabStore
          .getState()
          .tabs.find((item) => item.id === tabIdFromContext(context))
        if (!tab?.filePath) throw new Error('HTML 标签页已不存在')
        const result = await useCommandStore
          .getState()
          .executeCommand(
            `workbench.openAs.${tab.type === 'browser' ? 'source' : 'html'}`,
            context ?? { source: 'palette' },
          )
        if (!result.ok) throw new Error(result.message ?? '打开方式切换失败')
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
          enabled: Boolean(
            tabId &&
            tabs.some((tab) => tab.id === tabId) &&
            tabs.some((tab) => tab.id !== tabId && !tab.pinned),
          ),
          reason: '没有其他可关闭的标签页',
        }
      },
      action: async (context) => {
        const tabId = tabIdFromContext(context)
        if (!tabId) throw new Error('标签页已不存在')
        const tabs = useTabStore.getState().tabs
        const ids = tabs
          .filter((tab) => tab.id !== tabId && !tab.pinned)
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
          enabled: index >= 0 && tabs.slice(index + 1).some((tab) => !tab.pinned),
          reason: index < 0 ? '标签页已关闭' : '右侧没有可关闭的标签页',
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
            .filter((tab) => !tab.pinned)
            .map((tab) => tab.id)
            .reverse(),
        )
      },
    },
  ]
}

export const tabMenuContributions: MenuContribution[] = [
  // Compatibility owner for the legacy command; the unified open-as entries supersede its menu.
  {
    id: 'tab.html-alternative',
    targetKinds: ['tab'],
    group: '30-open',
    order: 10,
    commandId: 'workbench.openHtmlAlternative',
    when: () => false,
  },
  ...(['markdown', 'source', 'html'] as const).map(
    (mode): MenuContribution => ({
      id: `tab.open-as-${mode}`,
      targetKinds: ['tab'],
      group: '30-open',
      order: 11,
      commandId: `workbench.openAs.${mode}`,
      when: (context) => {
        const tab = useTabStore
          .getState()
          .tabs.find((item) => item.id === tabIdFromContext(context))
        const view = tab && contentPresentation(tab)
        return Boolean(
          view &&
          view.options.length > 1 &&
          view.selected !== mode &&
          view.options.some((option) => option.id === mode),
        )
      },
    }),
  ),
  {
    id: 'tab.pin',
    targetKinds: ['tab'],
    group: '20-edit',
    order: 20,
    commandId: 'workbench.toggleTabPinned',
    icon: '⚑',
  },
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
    id: 'tab.desktop-short-name',
    targetKinds: ['tab'],
    group: '20-edit',
    order: 30,
    commandId: 'workbench.setDesktopShortName',
    icon: '✎',
    when: (context) => Boolean(desktopTabFromContext(context)),
    inlineInput: {
      ariaLabel: '远程桌面简称（最多 2 个字）',
      initialValue: (context) => currentDesktopIdentity(context)?.text ?? '',
    },
  },
  {
    id: 'tab.desktop-color',
    targetKinds: ['tab'],
    group: '20-edit',
    order: 31,
    commandId: 'workbench.cycleDesktopColor',
    icon: '◐',
    when: (context) => Boolean(desktopTabFromContext(context)),
  },
  {
    id: 'tab.desktop-identity-reset',
    targetKinds: ['tab'],
    group: '20-edit',
    order: 32,
    commandId: 'workbench.resetDesktopIdentity',
    icon: '↺',
    when: (context) => Boolean(desktopTabFromContext(context)?.desktopIdentity),
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
    id: 'tab.copy-absolute-path',
    targetKinds: ['tab'],
    group: '40-copy',
    order: 20,
    commandId: 'fileTree.copyAbsolutePath',
    icon: '📋',
    when: isLocalFileBackedTab,
  },
  {
    id: 'tab.copy-relative-path',
    targetKinds: ['tab'],
    group: '40-copy',
    order: 30,
    commandId: 'fileTree.copyRelativePath',
    icon: '↳',
    when: isLocalFileBackedTab,
  },
  {
    id: 'tab.move-to-new-window',
    targetKinds: ['tab'],
    group: '90-manage',
    order: 5,
    commandId: 'workbench.moveTabToNewWindow',
    icon: '↗',
    when: (context) => {
      const tabId = tabIdFromContext(context)
      return useTabStore.getState().tabs.find((tab) => tab.id === tabId)?.type === 'browser'
    },
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
