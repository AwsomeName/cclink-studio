import { afterEach, describe, expect, it } from 'vitest'
import { createAgentConversationState } from '../agent-conversations/conversation-state'
import { useAgentStore } from '../../stores/agent-store'
import { createConversationTerminalCommands } from './conversation-terminal-command'
import type { CommandContext } from '../context-actions/context-target'

const original = useAgentStore.getState()
afterEach(() => useAgentStore.setState(original, true))

describe('conversation terminal command boundary', () => {
  it('only enables a finished assistant shell block in its local Codex or Claude workspace', () => {
    const conversation = createAgentConversationState('chat', {
      workspaceRef: { kind: 'local', path: '/workspace/a' },
    })
    const message = {
      id: 'message',
      role: 'assistant' as const,
      rawText: '',
      timestamp: 1,
      content: [{ type: 'text' as const, text: '```sh\npwd\n```' }],
    }
    conversation.messages = [message]
    useAgentStore.setState({ conversations: { chat: conversation } })
    const command = createConversationTerminalCommands()[0]
    const context: CommandContext = {
      source: 'toolbar',
      target: {
        kind: 'message',
        conversationId: 'chat',
        messageId: 'message',
        workspaceKey: '/workspace/a',
        codeBlock: { contentIndex: 0, line: 0 },
      },
    }
    expect(command.enabled?.(context)).toBe(true)
    expect(
      command.enabled?.({
        ...context,
        target: { ...context.target!, workspaceKey: '/workspace/b' } as typeof context.target,
      }),
    ).toBe(false)
    conversation.messages = [{ ...message, isStreaming: true }]
    expect(command.enabled?.(context)).toBe(false)
    conversation.messages = [{ ...message, role: 'user' }]
    expect(command.enabled?.(context)).toBe(false)
    conversation.messages = [message]
    conversation.runtimeBinding = { kind: 'acp', implementationId: 'codex-acp' }
    expect(command.enabled?.(context)).toBe(false)
    conversation.runtimeBinding = { kind: 'claude-code' }
    expect(command.enabled?.(context)).toBe(true)
    conversation.runtime.workspaceRef = { kind: 'global' }
    expect(command.enabled?.(context)).toBe(false)
  })
})
