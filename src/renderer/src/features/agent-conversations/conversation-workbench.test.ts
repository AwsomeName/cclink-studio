import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { createAgentConversationState } from './conversation-state'
import {
  CONVERSATION_DRAG_TYPE,
  hasConversationDragData,
  openConversationInWorkbench,
  readConversationDragData,
  writeConversationDragData,
} from './conversation-workbench'

const workspaceRef = localWorkspaceRef('/workspace/a')

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
  const conversation = createAgentConversationState('thread-1', { workspaceRef })
  conversation.title = '拖到中间'
  useAgentStore.setState({
    conversations: { 'thread-1': conversation },
    conversationOrder: ['thread-1'],
    activeConversationId: 'thread-1',
  })
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('conversation workbench view', () => {
  it('opens the same thread in one deduplicated Workbench Tab without moving its state', () => {
    expect(openConversationInWorkbench('thread-1')).toBe(true)
    expect(openConversationInWorkbench('thread-1')).toBe(true)

    const agentState = useAgentStore.getState()
    const tabState = useTabStore.getState()
    expect(agentState.conversations['thread-1'].surface).toBe('assistant-panel')
    expect(agentState.activeConversationId).toBe('thread-1')
    expect(tabState.tabs).toHaveLength(1)
    expect(tabState.tabs[0]).toMatchObject({
      type: 'conversation',
      title: '拖到中间',
      workspaceRef,
      conversation: {
        surface: 'workbench-tab',
        sessionId: 'thread-1',
      },
    })
    expect(tabState.activeTabId).toBe(tabState.tabs[0].id)

    useTabStore.getState().closeTab(tabState.tabs[0].id)
    expect(useAgentStore.getState().conversations['thread-1']).toBeDefined()
  })

  it('rejects missing or archived threads', () => {
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        'thread-1': { ...state.conversations['thread-1'], archivedAt: Date.now() },
      },
    }))

    expect(openConversationInWorkbench('missing')).toBe(false)
    expect(openConversationInWorkbench('thread-1')).toBe(false)
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('writes and reads the bounded conversation drag payload', () => {
    const payload = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'uninitialized',
      types: [CONVERSATION_DRAG_TYPE],
      setData: (type: string, value: string) => payload.set(type, value),
      getData: (type: string) => payload.get(type) ?? '',
    } as unknown as DataTransfer

    writeConversationDragData(dataTransfer, 'thread-1')

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(hasConversationDragData(dataTransfer)).toBe(true)
    expect(readConversationDragData(dataTransfer)).toBe('thread-1')
  })
})
