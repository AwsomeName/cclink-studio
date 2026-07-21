import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import {
  applyAgentCompleteToStore,
  applyAgentStreamEventToStore,
} from '../bootstrap/use-agent-stream-events'
import {
  hydrateRuntimeSections,
  persistRuntimeSections,
  reconcileAgentRuntimeStatuses,
  reconcileTerminalRuntimeStatuses,
} from './workspace-runtime'
import { setWorkspaceStatePath } from './workspace-state'

beforeEach(() => {
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: {
        setSection: vi.fn().mockResolvedValue({ success: true }),
      },
      terminal: {
        listSessions: vi.fn().mockResolvedValue([]),
      },
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
  useTabStore.setState(useTabStore.getInitialState(), true)
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setWorkspaceStatePath(null)
})

describe('workspace-runtime', () => {
  it('保存和恢复工作空间运行态时，项目 Tab 与工作会话跟随工作空间快照切换', () => {
    const conversationId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
      },
      activate: false,
    })
    useTabStore.getState().openTab({
      type: 'conversation',
      title: '工作会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
        },
        sessionId: conversationId,
      },
    })
    useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })

    persistRuntimeSections('/workspace/a')

    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    const tabsPayload = setSection.mock.calls.find((call) => call[1] === 'tabs')?.[2]
    const agentPayload = setSection.mock.calls.find((call) => call[1] === 'agentConversations')?.[2]

    expect(tabsPayload.tabs.map((tab: { type: string }) => tab.type)).toEqual(['conversation'])
    expect(agentPayload.conversations[conversationId].surface).toBe('workbench-tab')

    hydrateRuntimeSections({
      version: 1,
      workspaceId: '/workspace/b',
      ownerKey: null,
      workspaceKey: '/workspace/b',
      workspacePath: '/workspace/b',
      sections: {
        tabs: {
          tabs: [
            {
              id: 'browser-b',
              type: 'browser',
              title: 'B',
              icon: '🌐',
              workspaceRef: { kind: 'local', path: '/workspace/b' },
            },
          ],
          activeTabId: 'browser-b',
        },
        browserTabs: { tabs: {} },
        editorDrafts: { files: {} },
        agentConversations: {
          conversations: {},
          conversationOrder: [],
          activeConversationId: null,
        },
      },
      updatedAt: Date.now(),
    })

    expect(useTabStore.getState().tabs.map((tab) => tab.type)).toEqual(['settings', 'browser'])
    expect(useTabStore.getState().tabs.some((tab) => tab.id === 'browser-b')).toBe(true)
    expect(useTabStore.getState().activeTabId).toBe(
      useTabStore.getState().tabs.find((tab) => tab.type === 'settings')?.id,
    )
  })

  it('hydrate 期间不触发 store 订阅持久化，避免恢复中间态写回', () => {
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    setSection.mockClear()

    hydrateRuntimeSections({
      version: 1,
      workspaceId: '/workspace/restored',
      ownerKey: null,
      workspaceKey: '/workspace/restored',
      workspacePath: '/workspace/restored',
      sections: {
        tabs: {
          tabs: [{ id: 'browser-restored', type: 'browser', title: 'Restored', icon: '🌐' }],
          activeTabId: 'browser-restored',
        },
        browserTabs: {
          tabs: {
            'browser-restored': {
              url: 'https://example.com',
              urlInput: 'https://example.com',
              viewMode: 'desktop',
              zoomMode: 'fit',
              zoomFactor: 1,
              history: ['https://example.com'],
              historyIndex: 0,
              ready: false,
            },
          },
        },
        editorDrafts: { files: {} },
        agentConversations: {
          conversations: {},
          conversationOrder: [],
          activeConversationId: null,
        },
      },
      updatedAt: Date.now(),
    })

    expect(setSection).not.toHaveBeenCalled()
  })

  it('runtime store 只写 WorkspaceState，不再写全局 localStorage 镜像', () => {
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    const setLocalStorage = localStorage.setItem as ReturnType<typeof vi.fn>
    setSection.mockClear()
    setLocalStorage.mockClear()

    useBrowserStore.getState().ensureTab('browser-a', 'https://example.com')
    useTabStore.getState().openTab({ type: 'browser', title: '浏览器', icon: '🌐' })
    useEditorStore.getState().initVirtualFile('virtual:draft', 'draft')
    useAgentStore.getState().createConversation({ activate: true })

    expect(setSection.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining(['browserTabs', 'tabs', 'editorDrafts', 'agentConversations']),
    )
    expect(setLocalStorage).not.toHaveBeenCalled()
  })

  it('持久化指定项目时过滤其他项目的 Tab 和浏览器状态', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: 'A browser',
          icon: 'A',
          workspaceRef: { kind: 'local', path: '/workspace/a' },
        },
        {
          id: 'browser-b',
          type: 'browser',
          title: 'B browser',
          icon: 'B',
          workspaceRef: { kind: 'local', path: '/workspace/b' },
        },
      ],
      activeTabId: 'browser-b',
    })
    useBrowserStore.setState({
      tabs: {
        'browser-a': browserState('https://a.example'),
        'browser-b': browserState('https://b.example'),
      },
    })
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    setSection.mockClear()

    await persistRuntimeSections('/workspace/a')

    const tabsPayload = setSection.mock.calls.find((call) => call[1] === 'tabs')?.[2]
    const browserPayload = setSection.mock.calls.find((call) => call[1] === 'browserTabs')?.[2]
    expect(tabsPayload).toMatchObject({
      tabs: [{ id: 'browser-a' }],
      activeTabId: 'browser-a',
    })
    expect(Object.keys(browserPayload.tabs)).toEqual(['browser-a'])
  })

  it('切换项目时保留后台运行会话，并在切回后显示完整结果', async () => {
    const startedAt = Date.now() - 60_000
    const projectASnapshot = workspaceSnapshot('/workspace/a', {
      agentConversations: legacyConversationSnapshot('项目 A 会话', startedAt),
    })
    const projectBSnapshot = workspaceSnapshot('/workspace/b', {
      agentConversations: legacyConversationSnapshot('项目 B 会话', startedAt + 1_000),
    })

    hydrateRuntimeSections(projectASnapshot)
    const projectAConversationId = useAgentStore.getState().activeConversationId
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId: projectAConversationId,
      event: {
        type: 'message_start',
        message: { id: 'project-a-result' },
      },
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId: projectAConversationId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '切换项目后完成的结果' },
      },
    })

    hydrateRuntimeSections(projectBSnapshot)
    const projectBConversationId = useAgentStore.getState().activeConversationId
    expect(projectBConversationId).not.toBe(projectAConversationId)
    expect(useAgentStore.getState().conversations[projectAConversationId]).toBeDefined()

    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    setSection.mockClear()
    applyAgentCompleteToStore({
      conversationId: projectAConversationId,
      total_cost_usd: 0.02,
    })

    await vi.waitFor(() => {
      expect(
        setSection.mock.calls.some(
          (call) =>
            call[0] === '/workspace/a' &&
            call[1] === 'agentConversations' &&
            call[2].conversations[projectAConversationId].messages.at(-1)?.rawText ===
              '切换项目后完成的结果',
        ),
      ).toBe(true)
    })
    const projectAWrite = setSection.mock.calls
      .filter((call) => call[0] === '/workspace/a' && call[1] === 'agentConversations')
      .at(-1)
    expect(projectAWrite?.[2].conversations[projectAConversationId].messages.at(-1).rawText).toBe(
      '切换项目后完成的结果',
    )

    hydrateRuntimeSections(projectASnapshot)
    const restored = useAgentStore.getState().conversations[projectAConversationId]
    expect(useAgentStore.getState().activeConversationId).toBe(projectAConversationId)
    expect(restored.messages.at(-1)?.rawText).toBe('切换项目后完成的结果')
    expect(restored.loading).toBe(false)
    expect(restored.lastCost).toBe(0.02)
  })

  it('首个流事件到达前切换项目，也保留启动中的会话状态', () => {
    const startedAt = Date.now() - 60_000
    const projectASnapshot = workspaceSnapshot('/workspace/a', {
      agentConversations: legacyConversationSnapshot('项目 A 会话', startedAt),
    })
    const projectBSnapshot = workspaceSnapshot('/workspace/b', {
      agentConversations: legacyConversationSnapshot('项目 B 会话', startedAt + 1_000),
    })

    hydrateRuntimeSections(projectASnapshot)
    const projectAConversationId = useAgentStore.getState().activeConversationId
    useAgentStore.getState().addUserMessage('开始浏览器任务', projectAConversationId)
    useAgentStore.getState().beginRun(projectAConversationId)

    hydrateRuntimeSections(projectBSnapshot)
    expect(useAgentStore.getState().conversations[projectAConversationId]).toMatchObject({
      loading: true,
      backendState: 'connecting',
      runStatus: 'starting',
    })

    hydrateRuntimeSections(projectASnapshot)
    expect(useAgentStore.getState().activeConversationId).toBe(projectAConversationId)
    expect(useAgentStore.getState().conversations[projectAConversationId]).toMatchObject({
      loading: true,
      runStatus: 'starting',
    })
  })

  it('恢复后主进程仍在执行时继续接管原运行', async () => {
    hydrateRecoveringConversation()
    const getStatus = vi.fn().mockResolvedValue({
      connected: true,
      busy: true,
      ready: true,
      runId: 'run-before-reload',
      sessionId: 'session-1',
    })
    ;(window.cclinkStudio as unknown as { agent: { getStatus: typeof getStatus } }).agent = {
      getStatus,
    }

    await reconcileAgentRuntimeStatuses(null)

    expect(useAgentStore.getState().conversations.recovering).toMatchObject({
      loading: true,
      backendState: 'streaming',
      runStatus: 'running',
      activeRunId: 'run-before-reload',
      lastRunTerminalReason: null,
    })
  })

  it('恢复后主进程可用但运行已消失时标记为意外丢失', async () => {
    hydrateRecoveringConversation()
    const getStatus = vi.fn().mockResolvedValue({
      connected: false,
      busy: false,
      ready: true,
      runId: null,
      sessionId: 'session-1',
    })
    ;(window.cclinkStudio as unknown as { agent: { getStatus: typeof getStatus } }).agent = {
      getStatus,
    }

    await reconcileAgentRuntimeStatuses(null)

    expect(useAgentStore.getState().conversations.recovering).toMatchObject({
      loading: false,
      backendState: 'connected',
      runStatus: 'interrupted',
      activeRunId: null,
      streamingMessageId: null,
      lastRunTerminalReason: 'runtime-lost',
    })
  })

  it('主进程状态查询失败时记录运行时不可用，而不是用户取消', async () => {
    hydrateRecoveringConversation()
    const getStatus = vi.fn().mockRejectedValue(new Error('ipc unavailable'))
    ;(window.cclinkStudio as unknown as { agent: { getStatus: typeof getStatus } }).agent = {
      getStatus,
    }

    await reconcileAgentRuntimeStatuses(null)

    expect(useAgentStore.getState().conversations.recovering).toMatchObject({
      loading: false,
      backendState: 'disconnected',
      runStatus: 'interrupted',
      lastRunTerminalReason: 'runtime-unavailable',
    })
  })

  it('状态查询期间收到完成事件时忽略过期的 busy 回复', async () => {
    hydrateRecoveringConversation()
    let resolveStatus!: (value: {
      connected: boolean
      busy: boolean
      ready: boolean
      runId: string
      sessionId: string
    }) => void
    const getStatus = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve
      }),
    )
    ;(window.cclinkStudio as unknown as { agent: { getStatus: typeof getStatus } }).agent = {
      getStatus,
    }

    const reconciliation = reconcileAgentRuntimeStatuses(null)
    useAgentStore.getState().finishStreamingMessage('recovering', 'run-before-reload')
    resolveStatus({
      connected: true,
      busy: true,
      ready: true,
      runId: 'run-before-reload',
      sessionId: 'session-1',
    })
    await reconciliation

    expect(useAgentStore.getState().conversations.recovering).toMatchObject({
      loading: false,
      runStatus: 'completed',
      activeRunId: null,
      lastRunTerminalReason: 'completed',
    })
  })

  it('切回项目时用主进程 Terminal session 修正 Tab 的陈旧运行状态', async () => {
    setWorkspaceStatePath('/workspace/a')
    useTabStore.setState({
      tabs: [
        terminalTab('terminal-a', '/workspace/a', 'terminal-session-a'),
        terminalTab('terminal-b', '/workspace/b', 'terminal-session-b'),
      ],
      activeTabId: 'terminal-a',
    })
    const listSessions = window.cclinkStudio.terminal.listSessions as ReturnType<typeof vi.fn>
    listSessions.mockResolvedValueOnce([
      {
        sessionId: 'terminal-session-a',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: { kind: 'local', path: '/workspace/a' },
        },
        status: 'exited',
        createdAt: 1,
        updatedAt: 2,
        exitCode: 0,
        exitedAt: 2,
        attachable: false,
      },
    ])

    await reconcileTerminalRuntimeStatuses('/workspace/a')

    const [terminalA, terminalB] = useTabStore.getState().tabs
    expect(terminalA.terminal).toMatchObject({ status: 'exited', processId: undefined })
    expect(terminalA.terminalRecord).toMatchObject({
      sessionId: 'terminal-session-a',
      status: 'exited',
      exitCode: 0,
    })
    expect(terminalB.terminal?.status).toBe('running')
  })

  it('Terminal 状态查询返回时项目已切换则丢弃过期结果', async () => {
    setWorkspaceStatePath('/workspace/a')
    useTabStore.setState({
      tabs: [terminalTab('terminal-a', '/workspace/a', 'terminal-session-a')],
      activeTabId: 'terminal-a',
    })
    let resolveSessions!: (
      value: Awaited<ReturnType<typeof window.cclinkStudio.terminal.listSessions>>,
    ) => void
    const listSessions = window.cclinkStudio.terminal.listSessions as ReturnType<typeof vi.fn>
    listSessions.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSessions = resolve
      }),
    )

    const reconciliation = reconcileTerminalRuntimeStatuses('/workspace/a')
    setWorkspaceStatePath('/workspace/b')
    resolveSessions([
      {
        sessionId: 'terminal-session-a',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: { kind: 'local', path: '/workspace/a' },
        },
        status: 'exited',
        createdAt: 1,
        updatedAt: 2,
      },
    ])
    await reconciliation

    expect(useTabStore.getState().tabs[0].terminal?.status).toBe('running')
  })
})

function hydrateRecoveringConversation(): void {
  const now = Date.now()
  useAgentStore.getState().hydrateFromWorkspaceState({
    conversations: {
      recovering: {
        id: 'recovering',
        title: '恢复中的任务',
        messages: [
          {
            id: 'streaming-message',
            role: 'assistant',
            content: [{ type: 'text', text: '部分结果' }],
            rawText: '部分结果',
            timestamp: now,
            isStreaming: true,
          },
        ],
        input: '',
        loading: true,
        backendState: 'streaming',
        runStatus: 'running',
        activeRunId: 'run-before-reload',
        lastRunEventAt: now,
        lastRunTerminalReason: null,
        sessionId: 'session-1',
        streamingMessageId: 'streaming-message',
        lastCost: null,
        scope: { kind: 'all' },
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
    },
    conversationOrder: ['recovering'],
    activeConversationId: 'recovering',
  })
}

function workspaceSnapshot(
  workspaceKey: string,
  sections: Record<string, unknown>,
): Parameters<typeof hydrateRuntimeSections>[0] {
  return {
    version: 1,
    workspaceId: workspaceKey,
    ownerKey: null,
    workspaceKey,
    workspacePath: workspaceKey,
    sections: {
      tabs: { tabs: [], activeTabId: null },
      browserTabs: { tabs: {} },
      editorDrafts: { files: {} },
      ...sections,
    },
    updatedAt: Date.now(),
  }
}

function legacyConversationSnapshot(title: string, timestamp: number): Record<string, unknown> {
  return {
    conversations: {
      'agent-default': {
        id: 'agent-default',
        title,
        surface: 'assistant-panel',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
        },
        messages: [
          {
            id: 'welcome',
            role: 'assistant',
            content: [{ type: 'text', text: 'welcome' }],
            rawText: 'welcome',
            timestamp,
          },
        ],
        input: '',
        loading: false,
        backendState: 'connected',
        sessionId: null,
        streamingMessageId: null,
        lastCost: null,
        scope: { kind: 'all' },
        mountedResources: [],
        mountedSkills: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      },
    },
    conversationOrder: ['agent-default'],
    activeConversationId: 'agent-default',
  }
}

function browserState(url: string) {
  return {
    url,
    urlInput: url,
    viewMode: 'desktop' as const,
    zoomMode: 'fit' as const,
    zoomFactor: 1,
    history: [url],
    historyIndex: 0,
    ready: false,
  }
}

function terminalTab(id: string, workspacePath: string, sessionId: string) {
  const workspaceRef = { kind: 'local' as const, path: workspacePath }
  return {
    id,
    type: 'terminal' as const,
    title: id,
    icon: 'terminal',
    workspaceRef,
    terminal: {
      runtime: {
        location: 'local' as const,
        transport: 'local' as const,
        backend: 'local-shell' as const,
        workspaceRef,
      },
      permissionPolicy: { mode: 'ask-risky-command' as const, requireConfirmationFor: [] },
      status: 'running' as const,
      closePolicy: 'keep-running' as const,
      sessionId,
      processId: 123,
    },
  }
}
