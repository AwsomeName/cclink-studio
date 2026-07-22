import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../../stores/agent-store'
import { createAgentConversationState } from '../../agent-conversations/conversation-state'
import { createThreadContextCommands } from './thread-context-actions'
import { createMessageContextCommands } from './message-context-actions'

const workspaceRef = localWorkspaceRef('/workspace/a')

beforeEach(() => {
  const conversation = createAgentConversationState('thread-1', { workspaceRef })
  conversation.messages = [
    {
      id: 'message-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'review this' }],
      rawText: 'review this',
      timestamp: 1,
    },
  ]
  useAgentStore.setState({
    conversations: { 'thread-1': conversation },
    conversationOrder: ['thread-1'],
    activeConversationId: 'thread-1',
    messages: conversation.messages,
    input: '',
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Agent content context actions', () => {
  it('stops only the run id captured by the thread target', async () => {
    const abort = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      cclinkStudio: { agent: { abort } },
      dispatchEvent: vi.fn(),
    })
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        'thread-1': {
          ...state.conversations['thread-1'],
          loading: true,
          activeRunId: 'run-1',
          runStatus: 'running',
        },
      },
    }))
    const command = createThreadContextCommands().find(
      (item) => item.id === 'agent.stopConversationRun',
    )!
    const context = {
      source: 'context-menu' as const,
      target: {
        kind: 'thread' as const,
        workspaceKey: '/workspace/a',
        conversationId: 'thread-1',
        activeRunId: 'run-1',
      },
    }

    await command.action(context)

    expect(abort).toHaveBeenCalledWith('thread-1')
    expect(useAgentStore.getState().conversations['thread-1'].activeRunId).toBeNull()
  })

  it('disables a stop action after the thread run changes', () => {
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        'thread-1': {
          ...state.conversations['thread-1'],
          loading: true,
          activeRunId: 'run-new',
        },
      },
    }))
    const command = createThreadContextCommands().find(
      (item) => item.id === 'agent.stopConversationRun',
    )!
    const availability = command.enabled?.({
      source: 'context-menu',
      target: {
        kind: 'thread',
        workspaceKey: '/workspace/a',
        conversationId: 'thread-1',
        activeRunId: 'run-old',
      },
    })

    expect(availability).toMatchObject({ enabled: false })
  })

  it('quotes a message into the composer without sending it', () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('window', {
      cclinkStudio: { agent: { sendMessage } },
      dispatchEvent: vi.fn(),
    })
    const command = createMessageContextCommands().find(
      (item) => item.id === 'agent.quoteMessageInComposer',
    )!

    command.action({
      source: 'context-menu',
      target: {
        kind: 'message',
        workspaceKey: '/workspace/a',
        conversationId: 'thread-1',
        messageId: 'message-1',
      },
    })

    expect(useAgentStore.getState().conversations['thread-1'].input).toBe('> review this\n\n')
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
