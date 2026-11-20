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
import { workspaceRefKey, workspaceRefLabel } from '@shared/workspace-ref'
import {
  AGENT_FOLLOW_UP,
  followUpUnavailableReason,
} from '../../features/agent-conversations/follow-up-actions'
import {
  createConversationRunController,
  isConversationSendPending,
} from '../../features/agent-conversations/conversation-run-controller'
import { createConversationTerminalCommands } from '../../features/terminal/conversation-terminal-command'
import { conversationBusyStatus } from '../../features/agent-conversations/conversation-state'
import { conversationWorkspaceKey } from '../../features/agent-conversations/conversation-workspace-state'
import { isWorkspaceStateRestoring } from '../../utils/workspace-state'

function resetUnavailableReason(): string | undefined {
  const { ref } = captureActiveWorkspaceTarget()
  if (ref.kind === 'remote') return '远程会话暂不支持重置'
  const state = useAgentStore.getState()
  const chat = state.conversations[state.activeConversationId]
  if (
    !chat ||
    isWorkspaceStateRestoring() ||
    chat.runtime.location !== 'local' ||
    conversationWorkspaceKey(chat) !== workspaceRefKey(ref)
  )
    return '请先打开当前工作空间的本地会话'
  if (chat.archivedAt) return '请先恢复已归档会话'
  if (
    conversationBusyStatus(chat, state.pendingConfirmations) ||
    isConversationSendPending(chat.id)
  )
    return '请先结束本轮任务'
}

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
          const created = await useCclinkStore
            .getState()
            .createSession(activeWorkspaceRef, `会话 · ${workspaceRefLabel(activeWorkspaceRef)}`)
          if (
            isWorkspaceTargetCurrent(target) &&
            useCclinkStore.getState().selectedSessionId === created.id
          ) {
            useUIStore.getState().showAgentChat()
            requestAnimationFrame(() => {
              if (
                isWorkspaceTargetCurrent(target) &&
                useCclinkStore.getState().selectedSessionId === created.id
              )
                focusAgentComposer()
            })
          }
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
      enabled: () => {
        const reason = resetUnavailableReason()
        return { enabled: !reason, reason }
      },
      action: async () => {
        const reason = resetUnavailableReason()
        if (reason) throw new Error(reason)
        const state = useAgentStore.getState()
        const chat = state.conversations[state.activeConversationId]
        const target = captureActiveWorkspaceTarget()
        await window.cclinkStudio.agent.resetSession(chat.id)
        try {
          if (
            !isWorkspaceTargetCurrent(target) ||
            useAgentStore.getState().conversations[chat.id] !== chat
          )
            throw new Error('会话已变更，已保留聊天记录')
          await state.clearMessages(chat.id)
        } catch (error) {
          // Native reset succeeded even if the history write failed. Never resume the old session.
          const latest = useAgentStore.getState().conversations[chat.id]
          if (
            chat.sessionId &&
            latest?.sessionId === chat.sessionId &&
            !latest.activeRunId &&
            latest.lastRunId === chat.lastRunId
          )
            state.setSessionId(null, chat.id)
          throw error
        }
      },
    },
  ]
}
