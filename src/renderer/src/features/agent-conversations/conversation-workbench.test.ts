import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useTabStore } from '../../stores/tab-store'
import { createAgentConversationState } from './conversation-state'
import {
  CONVERSATION_DRAG_TYPE,
  hasConversationDragData,
  openConversationInWorkbench,
  openRemoteConversationInWorkbench,
  readConversationDragData,
  readRemoteConversationDragData,
  writeConversationDragData,
  writeRemoteConversationDragData,
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
  useCclinkStore.setState({ sessions: [] })
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

  it('opens a remote session in one deduplicated Workbench Tab', () => {
    const remoteRef = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    })
    useCclinkStore.setState({
      sessions: [
        {
          id: 'remote-1',
          name: '远程会话',
          workspaceId: remoteRef.workspaceId,
          workspacePath: remoteRef.path,
          serverId: remoteRef.endpointId,
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
          messageCount: 0,
          contextUsage: 0,
        },
      ],
    })

    expect(openRemoteConversationInWorkbench('remote-1', remoteRef)).toBe(true)
    expect(openRemoteConversationInWorkbench('remote-1', remoteRef)).toBe(true)
    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      type: 'remote-conversation',
      title: '远程会话',
      workspaceRef: remoteRef,
      remoteConversation: { sessionId: 'remote-1' },
    })
  })

  it('writes and validates a workspace-scoped remote conversation drag payload', () => {
    const remoteRef = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    })
    const payload = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'uninitialized',
      types: [],
      setData: (type: string, value: string) => {
        payload.set(type, value)
        ;(dataTransfer.types as string[]).push(type)
      },
      getData: (type: string) => payload.get(type) ?? '',
    } as unknown as DataTransfer

    writeRemoteConversationDragData(dataTransfer, 'remote-1', remoteRef)

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(hasConversationDragData(dataTransfer)).toBe(true)
    expect(readRemoteConversationDragData(dataTransfer)).toEqual({
      sessionId: 'remote-1',
      workspaceKey: 'cclink://agent-1/workspace-1',
    })
  })
})
