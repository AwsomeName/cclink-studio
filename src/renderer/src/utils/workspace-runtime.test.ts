import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import { hydrateRuntimeSections, persistRuntimeSections } from './workspace-runtime'

beforeEach(() => {
  vi.stubGlobal('window', {
    deepink: {
      workspaceState: {
        setSection: vi.fn().mockResolvedValue({ success: true }),
      },
    },
  })
  useTabStore.setState(useTabStore.getInitialState(), true)
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace-runtime', () => {
  it('保存和恢复工作空间运行态时，项目 Tab 与工作会话跟随工作空间快照切换', () => {
    const conversationId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
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
          backend: 'deepink-agent',
        },
        sessionId: conversationId,
      },
    })
    useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })

    persistRuntimeSections('/workspace/a')

    const setSection = window.deepink.workspaceState.setSection as ReturnType<typeof vi.fn>
    const tabsPayload = setSection.mock.calls.find((call) => call[1] === 'tabs')?.[2]
    const agentPayload = setSection.mock.calls.find(
      (call) => call[1] === 'agentConversations',
    )?.[2]

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
          tabs: [{ id: 'browser-b', type: 'browser', title: 'B', icon: '🌐' }],
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
})
