import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { restoreWorkspaceState, type WorkspaceBootstrapDeps } from './workspace-bootstrap-core'
import {
  resetWorkspaceBootstrapForTests,
  runWorkspaceBootstrapOnce,
} from './use-workspace-bootstrap'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
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
    resolveWorkspacePath: vi.fn(async (workspacePath: string) => workspacePath),
    getWorkspaceState: vi.fn().mockResolvedValue(snapshot(null, {})),
    setWorkspacePath: vi.fn(),
    hydrateLayout: vi.fn(),
    hydrateBrowserTabs: vi.fn(),
    hydrateTabs: vi.fn(),
    hydrateEditorDrafts: vi.fn(),
    hydrateFileTree: vi.fn(),
    hydrateAgentConversations: vi.fn(),
    beginRestore: vi.fn(),
    endRestore: vi.fn(),
    initWorkspace: vi.fn(async (workspacePath: string | null) => workspacePath),
    refreshWorkspace: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    ...overrides,
  }
}

describe('restoreWorkspaceState', () => {
  afterEach(() => {
    resetWorkspaceBootstrapForTests()
  })

  it('启动恢复只运行一次，避免 StrictMode 双 effect 触发工作区竞态', async () => {
    resetWorkspaceBootstrapForTests()
    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '/workspace/a' } as any),
      getWorkspaceState: vi.fn().mockResolvedValue(snapshot('/workspace/a', {})),
    })
    const depsFactory = vi.fn(() => deps)

    await Promise.all([
      runWorkspaceBootstrapOnce(depsFactory),
      runWorkspaceBootstrapOnce(depsFactory),
    ])

    expect(depsFactory).toHaveBeenCalledTimes(1)
    expect(deps.initWorkspace).toHaveBeenCalledTimes(1)
  })

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
    expect(deps.resolveWorkspacePath).toHaveBeenCalledWith('/workspace/a')
    expect(deps.getWorkspaceState).toHaveBeenCalledWith('/workspace/a')
    expect(deps.hydrateLayout).toHaveBeenCalledWith({ sidebarVisible: false })
    expect(deps.hydrateTabs).toHaveBeenCalledWith({ activeTabId: 'doc' })
    expect(deps.initWorkspace).toHaveBeenCalled()
  })

  it('工作区快照为空时不回退到 global，避免未归档状态串入项目', async () => {
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
    expect(getWorkspaceState).toHaveBeenCalledTimes(1)
    expect(deps.hydrateLayout).toHaveBeenCalledWith(undefined)
  })

  it('候选项目无效时只恢复 global，不读取失效项目快照', async () => {
    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '/workspace/missing' } as any),
      resolveWorkspacePath: vi.fn().mockResolvedValue(null),
      initWorkspace: vi.fn().mockResolvedValue(null),
      getWorkspaceState: vi.fn().mockResolvedValue(snapshot(null, {})),
    })

    await restoreWorkspaceState(deps)

    expect(deps.initWorkspace).toHaveBeenCalledWith(null, expect.anything())
    expect(deps.getWorkspaceState).toHaveBeenCalledWith(null)
    expect(deps.getWorkspaceState).not.toHaveBeenCalledWith('/workspace/missing')
  })

  it('工作区快照为空时清空运行态，不保留上一个项目的内存种子', async () => {
    useBrowserStore.setState(
      {
        ...useBrowserStore.getInitialState(),
        tabs: {
          stale: {
            url: 'https://stale.example',
            urlInput: 'https://stale.example',
            viewMode: 'desktop',
            zoomMode: 'fit',
            zoomFactor: 1,
            history: ['https://stale.example'],
            historyIndex: 0,
            ready: false,
          },
        },
      },
      true,
    )
    useTabStore.setState(
      {
        ...useTabStore.getInitialState(),
        tabs: [{ id: 'stale-tab', type: 'browser', title: 'Stale', icon: '🌐' }],
        activeTabId: 'stale-tab',
      },
      true,
    )
    useEditorStore.setState(
      {
        ...useEditorStore.getInitialState(),
        files: {
          'virtual:stale': {
            savedContent: '',
            currentContent: 'stale draft',
            dirty: true,
            loading: false,
          },
        },
      },
      true,
    )
    useAgentStore.setState(useAgentStore.getInitialState(), true)
    const staleConversationId = useAgentStore.getState().createConversation({ activate: true })

    const deps = createDeps({
      getSettings: vi.fn().mockResolvedValue({ lastWorkspacePath: '/workspace/empty' } as any),
      getWorkspaceState: vi.fn().mockResolvedValue(snapshot('/workspace/empty', {})),
      hydrateBrowserTabs: (value) => useBrowserStore.getState().hydrateFromWorkspaceState(value),
      hydrateTabs: (value) => useTabStore.getState().hydrateFromWorkspaceState(value),
      hydrateEditorDrafts: (value) => useEditorStore.getState().hydrateFromWorkspaceState(value),
      hydrateAgentConversations: (value) =>
        useAgentStore.getState().hydrateFromWorkspaceState(value),
    })

    await restoreWorkspaceState(deps)

    expect(useBrowserStore.getState().tabs).toEqual({})
    expect(useTabStore.getState().tabs).toEqual([])
    expect(useEditorStore.getState().files).toEqual({})
    expect(useAgentStore.getState().activeConversationId).not.toBe(staleConversationId)
  })

  it('状态恢复失败时记录告警，但仍尝试恢复工作区', async () => {
    const deps = createDeps({
      getWorkspaceState: vi.fn().mockRejectedValue(new Error('state broken')),
    })

    const result = await restoreWorkspaceState(deps)

    expect(deps.warn).toHaveBeenCalledWith(
      '[WorkspaceBootstrap] 工作台状态读取失败:',
      expect.any(Error),
    )
    expect(deps.initWorkspace).toHaveBeenCalled()
    expect(deps.hydrateTabs).not.toHaveBeenCalled()
    expect(result.canPersistRuntime).toBe(false)
  })

  it('状态应用失败时禁止把部分恢复结果写回', async () => {
    const deps = createDeps({
      hydrateTabs: vi.fn(() => {
        throw new Error('invalid tabs')
      }),
    })

    const result = await restoreWorkspaceState(deps)

    expect(result.canPersistRuntime).toBe(false)
    expect(deps.warn).toHaveBeenCalledWith(
      '[WorkspaceBootstrap] 工作台状态应用失败:',
      expect.any(Error),
    )
  })

  it('工作区恢复失败时只记录告警，不抛出异常', async () => {
    const deps = createDeps({
      initWorkspace: vi.fn().mockRejectedValue(new Error('workspace missing')),
    })

    await expect(restoreWorkspaceState(deps)).resolves.toEqual({
      workspacePath: null,
      canPersistRuntime: true,
    })
    expect(deps.warn).toHaveBeenCalledWith(
      '[WorkspaceBootstrap] 工作区确认失败:',
      expect.any(Error),
    )
  })

  it('先确认并打开项目，再读取该项目自己的现场', async () => {
    const order: string[] = []
    const deps = createDeps({
      getSettings: vi.fn(async () => ({ lastWorkspacePath: '/workspace/a' }) as any),
      resolveWorkspacePath: vi.fn(async () => {
        order.push('resolve')
        return '/workspace/a'
      }),
      initWorkspace: vi.fn(async () => {
        order.push('open')
        return '/workspace/a'
      }),
      getWorkspaceState: vi.fn(async () => {
        order.push('read-state')
        return snapshot('/workspace/a', {})
      }),
    })

    await restoreWorkspaceState(deps)

    expect(order).toEqual(['resolve', 'open', 'read-state'])
  })

  it('重启后同时恢复工作会话 Tab 与对应会话数据', async () => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    useAgentStore.setState(useAgentStore.getInitialState(), true)
    const now = Date.now()
    const conversationId = 'agent-work-restore'
    const workspacePath = '/workspace/cclink-studio'

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
                    backend: 'cclink-studio-agent',
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
                  backend: 'cclink-studio-agent',
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
