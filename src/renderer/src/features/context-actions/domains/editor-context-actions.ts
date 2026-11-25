import { workspaceRefKey } from '@shared/workspace-ref'
import type { AgentMountedResource } from '../../../types'
import type { MarkdownEditorAction } from '../editor-context-surface'
import { useAgentStore } from '../../../stores/agent-store'
import { useTabStore } from '../../../stores/tab-store'
import { useUIStore } from '../../../stores/ui-store'
import type { Command } from '../../../stores/command-store'
import { useToastStore } from '../../../components/common/Toast'
import { MAX_FILE_RANGE_BYTES, MAX_FILE_RANGE_LINES } from '../../agent-conversations/payload'
import { hashMarkdownSnapshotSha256 } from '../../markdown/markdown-codec'
import { focusAgentComposer } from '../../markdown/markdown-navigation'
import { copyTextToClipboard } from '../../../utils/clipboard'
import type { CommandContext, ContextTarget } from '../context-target'
import { getEditorContextSurface } from '../editor-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

type EditorTarget = Extract<ContextTarget, { kind: 'editor' | 'markdown-selection' }>

function editorTarget(context?: CommandContext): EditorTarget | null {
  const target = context?.target
  return target?.kind === 'editor' || target?.kind === 'markdown-selection' ? target : null
}

function targetRange(target: EditorTarget) {
  return target.kind === 'editor' ? target.range : target.range
}

function resolveSurface(context?: CommandContext) {
  const target = editorTarget(context)
  if (!target) throw new Error('编辑器目标已失效')
  const tabState = useTabStore.getState()
  const tab = tabState.tabs.find((item) => item.id === target.tabId)
  if (tab) {
    if (tabState.activeTabId !== target.tabId || tab.type !== 'editor') {
      throw new Error('编辑器 Tab 已切换')
    }
  } else {
    // Editors embedded in the My Space home page (今天 / 日记 / 计划) have no tab of their own;
    // their id is page-scoped, so the home tab hosting them must be the active one.
    const active = tabState.tabs.find((item) => item.id === tabState.activeTabId)
    if (active?.type !== 'workspace-home') throw new Error('编辑器 Tab 已切换')
  }
  const surface = getEditorContextSurface(target.tabId)
  if (!surface) throw new Error('编辑器操作面已销毁')
  const expected = targetRange(target)?.selectedText ?? ''
  if (expected && surface.getSelectionText() !== expected) throw new Error('编辑器选区已变化')
  return { target, surface }
}

function canUseSelection(context?: CommandContext): boolean {
  const target = editorTarget(context)
  return Boolean(target && targetRange(target)?.selectedText)
}

async function mountSelection(context?: CommandContext): Promise<void> {
  const { target } = resolveSurface(context)
  const range = targetRange(target)
  if (!range) throw new Error('编辑器选区已失效')
  const lineCount = range.endLine - range.startLine + 1
  const bytes = new TextEncoder().encode(range.sourceSnapshot).byteLength
  if (lineCount > MAX_FILE_RANGE_LINES || bytes > MAX_FILE_RANGE_BYTES) {
    throw new Error(`选区最多 ${MAX_FILE_RANGE_LINES} 行且不超过 ${MAX_FILE_RANGE_BYTES / 1024}KB`)
  }

  const agentStore = useAgentStore.getState()
  const conversationId = agentStore.activeConversationId
  const activeConversation = agentStore.conversations[agentStore.activeConversationId]
  const activeWorkspaceKey = activeConversation?.runtime.workspaceRef
    ? workspaceRefKey(activeConversation.runtime.workspaceRef)
    : null
  if (target.workspaceKey !== activeWorkspaceKey) throw new Error('当前会话已切换到其他项目')
  const snapshotHash = await hashMarkdownSnapshotSha256(range.sourceSnapshot)
  resolveSurface(context)
  if (useAgentStore.getState().activeConversationId !== conversationId) {
    throw new Error('当前会话已切换')
  }
  const name = target.filePath.split('/').pop() ?? '未命名'
  const resource: AgentMountedResource = {
    id: `file-range:${target.filePath || target.tabId}:${range.startLine}:${range.endLine}:${Date.now()}`,
    kind: 'file-range',
    label: `${name}:L${range.startLine}-L${range.endLine}`,
    detail: `${target.filePath || '未保存文档'} 第 ${range.startLine}-${range.endLine} 行`,
    ref: {
      type: 'file-range',
      path: target.filePath || undefined,
      tabId: target.tabId,
      ...(target.kind === 'editor' && target.editorKind === 'markdown'
        ? { format: 'markdown' as const }
        : {}),
      startLine: range.startLine,
      endLine: range.endLine,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
      selectedText: range.selectedText,
      sourceSnapshot: range.sourceSnapshot,
      snapshotHash,
      dirty: target.dirty,
    },
  }
  useAgentStore.getState().addMountedResource(resource, conversationId)
  useUIStore.getState().setAgentPanelMode('right', 'user')
  useToastStore.getState().show('已将编辑器选区挂到当前 Agent', 'success')
  requestAnimationFrame(focusAgentComposer)
}

function tableTarget(context?: CommandContext): { headerRow: boolean } | null {
  const target = editorTarget(context)
  return target?.kind === 'editor' && target.editorKind === 'markdown'
    ? (target.table ?? null)
    : null
}

function runTableAction(context: CommandContext | undefined, action: MarkdownEditorAction): void {
  const { surface } = resolveSurface(context)
  if (!surface.runMarkdownAction?.(action)) throw new Error('光标已不在表格内')
}

const TABLE_COMMANDS: Array<{ id: string; label: string; action: MarkdownEditorAction }> = [
  { id: 'markdown.table.addRowBefore', label: '在上方插入行', action: 'table-add-row-before' },
  { id: 'markdown.table.addRowAfter', label: '在下方插入行', action: 'table-add-row-after' },
  { id: 'markdown.table.deleteRow', label: '删除行', action: 'table-delete-row' },
  { id: 'markdown.table.deleteColumn', label: '删除列', action: 'table-delete-column' },
  { id: 'markdown.table.delete', label: '删除表格', action: 'table-delete' },
]

export function createEditorContextCommands(): Command[] {
  return [
    ...TABLE_COMMANDS.map(
      ({ id, label, action }): Command => ({
        id,
        label,
        contextOnly: true,
        category: '编辑器',
        risk: 'local-write',
        visible: (context) => Boolean(tableTarget(context)),
        enabled:
          action === 'table-delete-row'
            ? (context) => ({
                enabled: tableTarget(context)?.headerRow === false,
                reason: '表头行不能单独删除，可删除整个表格',
              })
            : undefined,
        action: (context) => runTableAction(context, action),
      }),
    ),
    {
      id: 'editor.cut',
      label: '剪切',
      contextOnly: true,
      category: '编辑器',
      risk: 'local-write',
      enabled: canUseSelection,
      action: (context) => resolveSurface(context).surface.cut(),
    },
    {
      id: 'editor.copy',
      label: '复制',
      contextOnly: true,
      category: '编辑器',
      enabled: canUseSelection,
      action: (context) => resolveSurface(context).surface.copy(),
    },
    {
      id: 'editor.paste',
      label: '粘贴',
      contextOnly: true,
      category: '编辑器',
      risk: 'local-write',
      action: (context) => resolveSurface(context).surface.paste(),
    },
    {
      id: 'editor.selectAll',
      label: '全选',
      contextOnly: true,
      category: '编辑器',
      action: (context) => resolveSurface(context).surface.selectAll(),
    },
    {
      id: 'editor.copyLinkAddress',
      label: '复制链接地址',
      contextOnly: true,
      category: '编辑器',
      visible: (context) => {
        const target = editorTarget(context)
        return Boolean(target?.kind === 'editor' && target.linkUrl)
      },
      action: async (context) => {
        const { target } = resolveSurface(context)
        if (target.kind !== 'editor' || !target.linkUrl) throw new Error('链接目标已失效')
        await copyTextToClipboard(target.linkUrl)
      },
    },
    {
      id: 'editor.copyImageSource',
      label: '复制图片来源',
      contextOnly: true,
      category: '编辑器',
      visible: (context) => {
        const target = editorTarget(context)
        return Boolean(target?.kind === 'editor' && target.imageSrc)
      },
      action: async (context) => {
        const { target } = resolveSurface(context)
        if (target.kind !== 'editor' || !target.imageSrc) throw new Error('图片目标已失效')
        await copyTextToClipboard(target.imageSrc)
      },
    },
    {
      id: 'markdown.sendSelectionToConversation',
      label: '将选区挂到 Agent',
      contextOnly: true,
      category: '编辑器',
      enabled: (context) => {
        const target = editorTarget(context)
        const range = target ? targetRange(target) : null
        if (!range) return false
        const lineCount = range.endLine - range.startLine + 1
        const bytes = new TextEncoder().encode(range.sourceSnapshot).byteLength
        return {
          enabled: lineCount <= MAX_FILE_RANGE_LINES && bytes <= MAX_FILE_RANGE_BYTES,
          reason: `选区最多 ${MAX_FILE_RANGE_LINES} 行且不超过 ${MAX_FILE_RANGE_BYTES / 1024}KB`,
        }
      },
      action: mountSelection,
    },
  ]
}

export const editorMenuContributions: MenuContribution[] = [
  ...TABLE_COMMANDS.map(
    ({ id }, index): MenuContribution => ({
      id: id.replace('markdown.table.', 'editor.table-'),
      targetKinds: ['editor'],
      group: '30-table',
      order: (index + 1) * 10,
      commandId: id,
    }),
  ),
  {
    id: 'editor.cut',
    targetKinds: ['editor', 'markdown-selection'],
    group: '20-edit',
    order: 10,
    commandId: 'editor.cut',
  },
  {
    id: 'editor.copy',
    targetKinds: ['editor', 'markdown-selection'],
    group: '20-edit',
    order: 20,
    commandId: 'editor.copy',
  },
  {
    id: 'editor.paste',
    targetKinds: ['editor', 'markdown-selection'],
    group: '20-edit',
    order: 30,
    commandId: 'editor.paste',
  },
  {
    id: 'editor.select-all',
    targetKinds: ['editor', 'markdown-selection'],
    group: '20-edit',
    order: 40,
    commandId: 'editor.selectAll',
  },
  {
    id: 'editor.copy-link-address',
    targetKinds: ['editor'],
    group: '40-copy',
    order: 10,
    commandId: 'editor.copyLinkAddress',
  },
  {
    id: 'editor.copy-image-source',
    targetKinds: ['editor'],
    group: '40-copy',
    order: 20,
    commandId: 'editor.copyImageSource',
  },
  {
    id: 'editor.send-selection',
    targetKinds: ['editor', 'markdown-selection'],
    group: '40-send',
    order: 10,
    commandId: 'markdown.sendSelectionToConversation',
  },
]
