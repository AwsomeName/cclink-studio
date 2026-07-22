import type { Command } from '../../../stores/command-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useTabStore } from '../../../stores/tab-store'
import { useToastStore } from '../../../components/common/Toast'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'
import { useUIStore } from '../../../stores/ui-store'
import { copyTextToClipboard } from '../../../utils/clipboard'
import { createConversationRunController } from '../../agent-conversations/conversation-run-controller'
import { focusAgentComposer } from '../../markdown/markdown-navigation'
import { buildAgentConversationContextDiagnosticMarkdown } from '../../diagnostics/conversation-context-diagnostics'

export const THREAD_RESTORED_EVENT = 'cclink:thread-restored'

function threadId(context?: CommandContext): string | null {
  return context?.target?.kind === 'thread' ? context.target.conversationId : null
}

function currentThread(context?: CommandContext) {
  const id = threadId(context)
  return id ? useAgentStore.getState().conversations[id] : undefined
}

export function createThreadContextCommands(): Command[] {
  return [
    {
      id: 'agent.openConversation',
      label: '打开会话',
      contextOnly: true,
      category: '会话',
      visible: (context) => Boolean(currentThread(context) && !currentThread(context)?.archivedAt),
      action: (context) => {
        const id = threadId(context)
        if (!id || !currentThread(context)) throw new Error('会话已不存在')
        useAgentStore.getState().switchConversation(id)
        useUIStore.getState().setAgentPanelMode('right', 'user')
        requestAnimationFrame(focusAgentComposer)
      },
    },
    {
      id: 'agent.renameConversation',
      label: '重命名',
      contextOnly: true,
      category: '会话',
      risk: 'local-write',
      enabled: (context) => Boolean(currentThread(context)),
      action: (context) => {
        const id = threadId(context)
        const title = context?.inputValue?.trim()
        if (!id || !title || !currentThread(context)) throw new Error('会话已不存在或名称为空')
        useAgentStore.getState().renameConversation(id, title)
      },
    },
    {
      id: 'agent.stopConversationRun',
      label: '停止当前任务',
      contextOnly: true,
      category: '会话',
      risk: 'destructive',
      visible: (context) => Boolean(currentThread(context)?.activeRunId),
      enabled: (context) => {
        const target = context.target?.kind === 'thread' ? context.target : null
        const current = currentThread(context)
        return {
          enabled: Boolean(
            target?.activeRunId && current?.activeRunId === target.activeRunId && current.loading,
          ),
          reason: '该会话的运行任务已经变化或结束',
        }
      },
      action: async (context) => {
        const target = context?.target?.kind === 'thread' ? context.target : null
        const current = currentThread(context)
        if (!target?.activeRunId || current?.activeRunId !== target.activeRunId) {
          throw new Error('会话运行任务已切换')
        }
        const result = await createConversationRunController({
          conversationId: target.conversationId,
        }).abort()
        if (result.status === 'failed') throw new Error(result.error)
        if (result.status !== 'accepted' || result.runId !== target.activeRunId) {
          throw new Error('当前任务未被停止')
        }
      },
    },
    {
      id: 'agent.copyConversationDiagnostics',
      label: '复制会话诊断',
      contextOnly: true,
      category: '会话',
      action: async (context) => {
        const conversation = currentThread(context)
        if (!conversation) throw new Error('会话已不存在')
        await copyTextToClipboard(buildAgentConversationContextDiagnosticMarkdown(conversation))
        useToastStore.getState().show('会话诊断已复制', 'success')
      },
    },
    {
      id: 'agent.archiveConversation',
      label: '移到历史会话',
      contextOnly: true,
      category: '会话',
      visible: (context) => Boolean(currentThread(context) && !currentThread(context)?.archivedAt),
      action: async (context) => {
        const id = threadId(context)
        if (!id || !currentThread(context)) throw new Error('会话已不存在')
        try {
          await useAgentStore.getState().archiveConversation(id)
          const tabStore = useTabStore.getState()
          tabStore.tabs
            .filter((tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id)
            .forEach((tab) => tabStore.closeTab(tab.id))
        } catch (error) {
          useToastStore.getState().show(`会话已移到历史，但保存失败：${String(error)}`, 'error')
        }
      },
    },
    {
      id: 'agent.restoreConversation',
      label: '恢复到会话列表',
      contextOnly: true,
      category: '会话',
      visible: (context) => Boolean(currentThread(context)?.archivedAt),
      action: async (context) => {
        const id = threadId(context)
        if (!id || !currentThread(context)) throw new Error('会话已不存在')
        try {
          await useAgentStore.getState().restoreArchivedConversation(id)
          window.dispatchEvent(new CustomEvent(THREAD_RESTORED_EVENT, { detail: { id } }))
        } catch (error) {
          useToastStore.getState().show(`会话已恢复，但保存失败：${String(error)}`, 'error')
        }
      },
    },
  ]
}

export const threadMenuContributions: MenuContribution[] = [
  {
    id: 'thread.open',
    targetKinds: ['thread'],
    group: '10-open',
    order: 10,
    commandId: 'agent.openConversation',
  },
  {
    id: 'thread.rename',
    targetKinds: ['thread'],
    group: '20-edit',
    order: 10,
    commandId: 'agent.renameConversation',
    icon: '✎',
    inlineInput: {
      ariaLabel: '重命名会话',
      initialValue: (context) => currentThread(context)?.title ?? '',
    },
  },
  {
    id: 'thread.stop-run',
    targetKinds: ['thread'],
    group: '80-run',
    order: 10,
    commandId: 'agent.stopConversationRun',
  },
  {
    id: 'thread.copy-diagnostics',
    targetKinds: ['thread'],
    group: '80-run',
    order: 20,
    commandId: 'agent.copyConversationDiagnostics',
  },
  {
    id: 'thread.archive',
    targetKinds: ['thread'],
    group: '90-manage',
    order: 10,
    commandId: 'agent.archiveConversation',
    icon: '⌄',
  },
  {
    id: 'thread.restore',
    targetKinds: ['thread'],
    group: '90-manage',
    order: 20,
    commandId: 'agent.restoreConversation',
    icon: '↶',
  },
]
