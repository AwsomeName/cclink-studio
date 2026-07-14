import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { restoreWorkspaceState, type WorkspaceBootstrapDeps } from './workspace-bootstrap-core'
import { useAgentStore } from '../stores/agent-store'
import { useTabStore } from '../stores/tab-store'
import { resolveConversationTab } from '../utils/conversation-tab'

function snapshot(
  workspacePath: string | null,
  sections: Record<string, unknown>,
): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: workspacePath ?? 'global',
    ownerKey: null,
    workspaceKey: workspacePath,
    workspacePath,
    updatedAt: 1,
    sections,
  }
}

function createDeps(overrides: Partial<WorkspaceBootstrapDeps> = {}): WorkspaceBootstrapDeps {
  return {
    getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '' } as any),
    getWorkspaceState: vi.fn().mockResolvedValue(snapshot(null, {})),
    setWorkspacePath: vi.fn(),
    hydrateLayout: vi.fn(),
    hydrateBrowserTabs: vi.fn(),
    hydrateTabs: vi.fn(),
    hydrateEditorDrafts: vi.fn(),
    hydrateAgentConversations: vi.fn(),
    initWorkspace: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    ...overrides,
  }
}

describe('restoreWorkspaceState', () => {
  it('按 lastWorkspacePath 优先恢复对应工作区快照', async () => {
    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '/workspace/a' } as any),
      getWorkspaceState: vi.fn().mockResolvedValue(
        snapshot('/workspace/a', {
          layout: { sidebarVisible: false },
          browserTabs: { tabs: {} },
          tabs: { activeTabId: 'doc' },
          editorDrafts: { files: {} },
          agentConversations: { activeConversationId: 'agent' },
        }),
      ),
    })

    await restoreWorkspaceState(deps)

    expect(deps.setWorkspacePath).toHaveBeenCalledWith('/workspace/a')
    expect(deps.getWorkspaceState).toHaveBeenCalledWith('/workspace/a')
    expect(deps.hydrateLayout).toHaveBeenCalledWith({ sidebarVisible: false })
    expect(deps.hydrateTabs).toHaveBeenCalledWith({ activeTabId: 'doc' })
    expect(deps.initWorkspace).toHaveBeenCalled()
  })

  it('工作区快照为空时回退到 global 快照，兼容旧版本迁移', async () => {
    const getWorkspaceState = vi
      .fn()
      .mockResolvedValueOnce(snapshot('/workspace/a', {}))
      .mockResolvedValueOnce(snapshot(null, { layout: { activePanel: 'files' } }))
    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '/workspace/a' } as any),
      getWorkspaceState,
    })

    await restoreWorkspaceState(deps)

    expect(getWorkspaceState).toHaveBeenNthCalledWith(1, '/workspace/a')
    expect(getWorkspaceState).toHaveBeenNthCalledWith(2, null)
    expect(deps.hydrateLayout).toHaveBeenCalledWith({ activePanel: 'files' })
  })

  it('状态恢复失败时记录告警，但仍尝试恢复工作区', async () => {
    const deps = createDeps({
      getWorkspaceState: vi.fn().mockRejectedValue(new Error('state broken')),
    })

    await restoreWorkspaceState(deps)

    expect(deps.warn).toHaveBeenCalledWith(
      '[WorkspaceBootstrap] 全局工作台状态恢复失败:',
      expect.any(Error),
    )
    expect(deps.initWorkspace).toHaveBeenCalled()
  })

  it('工作区恢复失败时只记录告警，不抛出异常', async () => {
    const deps = createDeps({
      initWorkspace: vi.fn().mockRejectedValue(new Error('workspace missing')),
    })

    await expect(restoreWorkspaceState(deps)).resolves.toBeUndefined()
    expect(deps.warn).toHaveBeenCalledWith(
      '[WorkspaceBootstrap] 工作区恢复失败:',
      expect.any(Error),
    )
  })

  it('重启后同时恢复工作会话 Tab 与对应会话数据', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    useAgentStore.setState(useAgentStore.getInitialState(), true)
    const now = Date.now()
    const conversationId = 'agent-work-restore'
    const workspacePath = '/workspace/deepink'

    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: workspacePath } as any),
      getWorkspaceState: vi.fn().mockResolvedValue(
        snapshot(workspacePath, {
          tabs: {
            tabs: [
              {
                id: 'work-conversation-tab',
                type: 'conversation',
                title: '恢复后的工作会话',
                icon: '🤖',
                conversation: {
                  surface: 'workbench-tab',
                  runtime: {
                    location: 'local',
                    transport: 'local',
                    backend: 'deepink-agent',
                    workspaceRef: {
                      kind: 'local',
                      path: workspacePath,
                    },
                  },
                  sessionId: conversationId,
                },
              },
            ],
            activeTabId: 'work-conversation-tab',
          },
          agentConversations: {
            conversations: {
              [conversationId]: {
                id: conversationId,
                title: '恢复后的工作会话',
                surface: 'workbench-tab',
                runtime: {
                  location: 'local',
                  transport: 'local',
                  backend: 'deepink-agent',
                  workspaceRef: {
                    kind: 'local',
                    path: workspacePath,
                  },
                },
                messages: [
                  {
                    id: 'msg-restore',
                    role: 'user',
                    content: [{ type: 'text', text: '恢复这条工作消息' }],
                    rawText: '恢复这条工作消息',
                    timestamp: now,
                  },
                ],
                input: '未发送草稿不会恢复',
                loading: true,
                backendState: 'streaming',
                sessionId: 'runtime-session',
                streamingMessageId: 'streaming-message',
                lastCost: 0.2,
                scope: { kind: 'all' },
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
              },
            },
            conversationOrder: [conversationId],
            activeConversationId: conversationId,
          },
        }),
      ),
      hydrateTabs: (value) => useTabStore.getState().hydrateFromWorkspaceState(value),
      hydrateAgentConversations: (value) =>
        useAgentStore.getState().hydrateFromWorkspaceState(value),
    })

    await restoreWorkspaceState(deps)

    const tabState = useTabStore.getState()
    const agentState = useAgentStore.getState()
    const restoredTab = tabState.tabs[0]
    expect(tabState.activeTabId).toBe('work-conversation-tab')
    expect(resolveConversationTab(restoredTab)).toEqual({
      kind: 'local-agent',
      tabId: 'work-conversation-tab',
      conversationId,
    })
    expect(agentState.activeConversationId).toBe(conversationId)
    expect(agentState.conversations[conversationId].messages.at(-1)?.rawText).toBe(
      '恢复这条工作消息',
    )
    expect(agentState.conversations[conversationId].loading).toBe(false)
    expect(agentState.conversations[conversationId].streamingMessageId).toBeNull()
    expect(agentState.messages.at(-1)?.rawText).toBe('恢复这条工作消息')
  })
})
