import { workspaceRefKey } from '@shared/workspace-ref'
import type { AgentMessage } from '../../../types'
import type { Command } from '../../../stores/command-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useUIStore } from '../../../stores/ui-store'
import { useToastStore } from '../../../components/common/Toast'
import { copyTextToClipboard } from '../../../utils/clipboard'
import { focusAgentComposer } from '../../markdown/markdown-navigation'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function resolveMessage(context?: CommandContext): {
  conversationId: string
  message: AgentMessage
} | null {
  const target = context?.target?.kind === 'message' ? context.target : null
  if (!target) return null
  const conversation = useAgentStore.getState().conversations[target.conversationId]
  const workspaceKey = conversation?.runtime.workspaceRef
    ? workspaceRefKey(conversation.runtime.workspaceRef)
    : null
  const message = conversation?.messages.find((item) => item.id === target.messageId)
  return conversation && workspaceKey === target.workspaceKey && message
    ? { conversationId: conversation.id, message }
    : null
}

function messageText(message: AgentMessage): string {
  if (message.rawText.trim()) return message.rawText.trim()
  return message.content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text]
      if (block.type === 'thinking') return [block.thinking]
      if (block.type === 'tool_result') return [block.content]
      return []
    })
    .join('\n\n')
    .trim()
}

export function createMessageContextCommands(): Command[] {
  return [
    {
      id: 'agent.copyMessage',
      label: '复制消息',
      contextOnly: true,
      category: '会话消息',
      enabled: (context) =>
        Boolean(resolveMessage(context) && messageText(resolveMessage(context)!.message)),
      action: async (context) => {
        const resolved = resolveMessage(context)
        if (!resolved) throw new Error('消息已不存在')
        await copyTextToClipboard(messageText(resolved.message))
        useToastStore.getState().show('消息已复制', 'success')
      },
    },
    {
      id: 'agent.copyMessageMarkdown',
      label: '复制为 Markdown',
      contextOnly: true,
      category: '会话消息',
      enabled: (context) =>
        Boolean(resolveMessage(context) && messageText(resolveMessage(context)!.message)),
      action: async (context) => {
        const resolved = resolveMessage(context)
        if (!resolved) throw new Error('消息已不存在')
        await copyTextToClipboard(messageText(resolved.message))
        useToastStore.getState().show('消息 Markdown 已复制', 'success')
      },
    },
    {
      id: 'agent.quoteMessageInComposer',
      label: '引用到输入框',
      contextOnly: true,
      category: '会话消息',
      action: (context) => {
        const resolved = resolveMessage(context)
        if (!resolved) throw new Error('消息已不存在')
        const store = useAgentStore.getState()
        const text = messageText(resolved.message)
        const quote = text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        const current = store.conversations[resolved.conversationId]?.input ?? ''
        store.setInput(
          `${current}${current.trim() ? '\n\n' : ''}${quote}\n\n`,
          resolved.conversationId,
        )
        store.switchConversation(resolved.conversationId)
        useUIStore.getState().setAgentPanelMode('right', 'user')
        useToastStore.getState().show('消息已引用到输入框，尚未发送', 'success')
        requestAnimationFrame(focusAgentComposer)
      },
    },
  ]
}

export const messageMenuContributions: MenuContribution[] = [
  {
    id: 'message.copy',
    targetKinds: ['message'],
    group: '40-copy',
    order: 10,
    commandId: 'agent.copyMessage',
  },
  {
    id: 'message.copy-markdown',
    targetKinds: ['message'],
    group: '40-copy',
    order: 20,
    commandId: 'agent.copyMessageMarkdown',
  },
  {
    id: 'message.quote',
    targetKinds: ['message'],
    group: '50-compose',
    order: 10,
    commandId: 'agent.quoteMessageInComposer',
  },
]
