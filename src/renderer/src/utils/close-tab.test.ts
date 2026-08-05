import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../stores/agent-store'
import { useTabStore } from '../stores/tab-store'
import { closeTabWithDraftPolicy } from './close-tab'

beforeEach(() => {
  vi.restoreAllMocks()
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useTabStore.setState({
    tabs: [{ id: 'browser', type: 'browser', title: '浏览器', icon: '🌐' }],
    activeTabId: 'browser',
  })
  vi.stubGlobal('window', {
    cclinkStudio: {
      dialog: {
        showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
      },
      terminal: {
        recordLifecycleEvent: vi.fn().mockResolvedValue({ success: true }),
      },
      webResources: {
        cancelDraft: vi.fn().mockResolvedValue({
          success: true,
          data: { draftId: 'draft-1', cleaned: true },
        }),
      },
    },
  })
})

describe('closeTabWithDraftPolicy conversation lifecycle', () => {
  it('关闭本地工作会话 Tab 只关闭视图，不删除会话', async () => {
    const conversationId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
      },
    })
    useAgentStore.getState().addUserMessage('保留这条消息', conversationId)

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
    const tabId = useTabStore.getState().activeTabId!

    await closeTabWithDraftPolicy(tabId)

    expect(useTabStore.getState().tabs.some((tab) => tab.id === tabId)).toBe(false)
    expect(useAgentStore.getState().conversations[conversationId]).toBeDefined()
    expect(useAgentStore.getState().conversations[conversationId].messages.at(-1)?.rawText).toBe(
      '保留这条消息',
    )
  })
})

describe('closeTabWithDraftPolicy terminal lifecycle', () => {
  it('关闭 idle Terminal Tab 不弹确认', async () => {
    const runtime = {
      location: 'local' as const,
      transport: 'local' as const,
      backend: 'local-shell' as const,
      workspaceRef: { kind: 'local' as const, path: '/workspace' },
      cwd: '/workspace',
    }

    useTabStore.getState().openTab({
      type: 'terminal',
      title: 'Terminal',
      icon: '⌨️',
      terminal: {
        runtime,
        permissionPolicy: {
          mode: 'ask-risky-command',
          requireConfirmationFor: ['write', 'destructive', 'privileged', 'unknown'],
        },
        status: 'idle',
        closePolicy: 'terminate-process',
        sessionId: 'terminal-idle',
      },
    })
    const tabId = useTabStore.getState().activeTabId!

    await closeTabWithDraftPolicy(tabId)

    expect(window.cclinkStudio.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-idle',
      workspaceKey: '/workspace',
      kind: 'closed',
      message: 'Terminal 视图已关闭',
      runtime,
      permissionPolicy: {
        mode: 'ask-risky-command',
        requireConfirmationFor: ['write', 'destructive', 'privileged', 'unknown'],
      },
      closePolicy: 'terminate-process',
    })
    expect(useTabStore.getState().tabs.some((tab) => tab.id === tabId)).toBe(false)
  })

  it('关闭 running Terminal Tab 不弹确认，直接关闭视图', async () => {
    const runtime = {
      location: 'local' as const,
      transport: 'local' as const,
      backend: 'local-shell' as const,
      workspaceRef: {
        kind: 'local' as const,
        path: '/workspace',
      },
      cwd: '/workspace',
    }

    useTabStore.getState().openTab({
      type: 'terminal',
      title: 'Terminal',
      icon: '⌨️',
      terminal: {
        runtime,
        permissionPolicy: {
          mode: 'ask-every-command',
          requireConfirmationFor: [
            'read',
            'write',
            'network',
            'destructive',
            'privileged',
            'unknown',
          ],
        },
        status: 'running',
        closePolicy: 'terminate-process',
        sessionId: 'terminal-running',
      },
    })
    const tabId = useTabStore.getState().activeTabId!

    await closeTabWithDraftPolicy(tabId)

    expect(window.cclinkStudio.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(window.cclinkStudio.terminal.recordLifecycleEvent).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-running',
      workspaceKey: '/workspace',
      kind: 'closed',
      message: 'Terminal 视图已关闭，进程保留',
      runtime,
      permissionPolicy: {
        mode: 'ask-every-command',
        requireConfirmationFor: [
          'read',
          'write',
          'network',
          'destructive',
          'privileged',
          'unknown',
        ],
      },
      closePolicy: 'terminate-process',
    })
    expect(useTabStore.getState().tabs.some((tab) => tab.id === tabId)).toBe(false)
  })
})

describe('closeTabWithDraftPolicy scheduled task drafts', () => {
  it('keeps a dirty scheduled task open when the user continues editing', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'scheduled-task',
          type: 'scheduled-task',
          title: '每周工作总结',
          icon: '🕒',
          dirty: true,
          workspaceRef: { kind: 'local', path: '/workspace' },
          scheduledTask: { taskId: null, draftKey: 'draft-1' },
        },
      ],
      activeTabId: 'scheduled-task',
    })
    vi.mocked(window.cclinkStudio.dialog.showMessageBox).mockResolvedValueOnce({
      response: 1,
      checkboxChecked: false,
    })

    expect(await closeTabWithDraftPolicy('scheduled-task')).toBe(false)
    expect(useTabStore.getState().tabs).toHaveLength(1)
  })

  it('closes a dirty scheduled task only after explicit discard', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'scheduled-task',
          type: 'scheduled-task',
          title: '每周工作总结',
          icon: '🕒',
          dirty: true,
          workspaceRef: { kind: 'local', path: '/workspace' },
          scheduledTask: { taskId: '11111111-1111-4111-8111-111111111111', draftKey: 'task-1' },
        },
      ],
      activeTabId: 'scheduled-task',
    })

    expect(await closeTabWithDraftPolicy('scheduled-task')).toBe(true)
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })
})

describe('closeTabWithDraftPolicy website-account drafts', () => {
  it('cleans the isolated draft before closing its Browser Tab', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'web-draft-tab',
          type: 'browser',
          title: '未保存的网站账号',
          icon: '🌐',
          workspaceRef: { kind: 'local', path: '/workspace' },
          browserProfile: 'web-draft-profile',
          webResourceDraftRef: { draftId: 'draft-1' },
        },
      ],
      activeTabId: 'web-draft-tab',
    })

    expect(await closeTabWithDraftPolicy('web-draft-tab')).toBe(true)
    expect(window.cclinkStudio.webResources.cancelDraft).toHaveBeenCalledWith({
      workspaceRef: { kind: 'local', path: '/workspace' },
      draftId: 'draft-1',
      tabId: 'web-draft-tab',
    })
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })
})
