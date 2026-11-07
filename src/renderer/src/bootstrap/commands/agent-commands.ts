import type { Command } from '../../stores/command-store'
import { useAgentStore } from '../../stores/agent-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useUIStore } from '../../stores/ui-store'
import {
  captureActiveWorkspaceTarget,
  isWorkspaceTargetCurrent,
} from '../../stores/workspace-store'
import { createConversationRuntimeForWorkspace } from '../../features/agent-conversations/view-model'
import { focusAgentComposer } from '../../features/markdown/markdown-navigation'
import { workspaceRefLabel } from '@shared/workspace-ref'
import {
  AGENT_FOLLOW_UP,
  followUpUnavailableReason,
} from '../../features/agent-conversations/follow-up-actions'
import { createConversationRunController } from '../../features/agent-conversations/conversation-run-controller'

import { createConversationTerminalCommands } from '../../features/terminal/conversation-terminal-command'

export function createAgentCommands(): Command[] {
  return [
    ...createConversationTerminalCommands(),
    ...Object.entries(AGENT_FOLLOW_UP).map(
      ([action, definition]): Command => ({
        id: definition.id,
        label: definition.label,
        category: 'Agent',
        contextOnly: true,
        ...(action === 'supplement'
          ? {
              shortcutPolicy: {
                scope: 'agent' as const,
                inputPolicy: 'allow' as const,
                defaultBindings: [{ code: 'Enter', modifiers: ['primary' as const] }],
              },
            }
          : {}),
        enabled: (context) => {
          const target = context.target?.kind === 'thread' ? context.target : null
          const conversation = target
            ? useAgentStore.getState().conversations[target.conversationId]
            : undefined
          const reason =
            target?.activeRunId !== conversation?.activeRunId
              ? '原任务已结束或切换'
              : followUpUnavailableReason(conversation, action as keyof typeof AGENT_FOLLOW_UP)
          return { enabled: !reason && Boolean(target), reason: reason ?? undefined }
        },
        action: async (context) => {
          const target = context?.target?.kind === 'thread' ? context.target : null
          const conversation = target
            ? useAgentStore.getState().conversations[target.conversationId]
            : undefined
          if (!target || !conversation || target.activeRunId !== conversation.activeRunId)
            throw new Error('原任务已结束或切换')
          const reason = followUpUnavailableReason(
            conversation,
            action as keyof typeof AGENT_FOLLOW_UP,
          )
          if (reason) throw new Error(reason)
          const controller = createConversationRunController({ conversationId: conversation.id })
          const result =
            action === 'supplement'
              ? await controller.supplement(conversation.input)
              : await controller.stopAndSend(conversation.input)
          if (result.status === 'failed') throw new Error(result.error)
          if (result.status === 'ignored') throw new Error('目标任务或输入已变化，请重新检查')
        },
      }),
    ),
    {
      id: 'agent.showConversations',
      label: '打开右侧会话列表',
      category: 'Agent',
      action: () => useUIStore.getState().showAgentSessions(),
    },
    {
      id: 'agent.newConversation',
      label: '新建 Agent 会话',
      category: 'Agent',
      action: async () => {
        const target = captureActiveWorkspaceTarget()
        const activeWorkspaceRef = target.ref
        if (activeWorkspaceRef.kind === 'remote') {
          await useCclinkStore
            .getState()
            .createSession(activeWorkspaceRef, `会话 · ${workspaceRefLabel(activeWorkspaceRef)}`)
          if (isWorkspaceTargetCurrent(target)) useUIStore.getState().showAgentChat()
          return
        }
        const conversationId = useAgentStore.getState().createConversation({
          runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
          activate: true,
        })
        useUIStore.getState().showAgentChat()
        try {
          await window.cclinkStudio.agent.resetSession(conversationId)
        } finally {
          requestAnimationFrame(() => {
            if (isWorkspaceTargetCurrent(target)) focusAgentComposer()
          })
        }
      },
    },
    {
      id: 'agent.resetSession',
      label: '重置 Agent 会话',
      category: 'Agent',
      action: () => {
        const { activeConversationId, clearMessages } = useAgentStore.getState()
        void clearMessages(activeConversationId)
        window.cclinkStudio.agent.resetSession(activeConversationId)
      },
    },
  ]
}
