import { describe, expect, it } from 'vitest'
import { localWorkspaceRef, type WorkspaceRef } from '@shared/workspace-ref'
import {
  scopeLegacyConversationId,
  scopeWorkspaceAgentSnapshot,
  scopeWorkspaceBrowserSnapshot,
  scopeWorkspaceEditorDraftSnapshot,
  scopeWorkspaceTabSnapshot,
} from './conversation-workspace'

describe('conversation workspace scoping', () => {
  it('为不同项目生成不同的旧默认会话 ID', () => {
    expect(scopeLegacyConversationId('agent-default', localWorkspaceRef('/workspace/a'))).not.toBe(
      scopeLegacyConversationId('agent-default', localWorkspaceRef('/workspace/b')),
    )
  })

  it('同步迁移会话快照和工作会话 Tab 引用', () => {
    const workspaceRef = localWorkspaceRef('/workspace/a')
    const scoped = scopeWorkspaceAgentSnapshot(
      {
        conversations: {
          'agent-default': {
            id: 'agent-default',
            runtime: { location: 'local', transport: 'local' },
          },
        },
        conversationOrder: ['agent-default'],
        activeConversationId: 'agent-default',
      },
      workspaceRef,
    )
    const scopedId = scoped.conversationIdMap.get('agent-default')
    const tabs = scopeWorkspaceTabSnapshot(
      {
        tabs: [
          {
            id: 'conversation-tab',
            type: 'conversation',
            conversation: {
              surface: 'workbench-tab',
              runtime: { location: 'local', transport: 'local' },
              sessionId: 'agent-default',
            },
          },
        ],
        activeTabId: 'conversation-tab',
      },
      scoped.conversationIdMap,
      workspaceRef,
    ) as {
      tabs: Array<{ conversation: { sessionId: string } }>
    }

    expect(scopedId).toBeTruthy()
    expect((scoped.value as { activeConversationId: string }).activeConversationId).toBe(scopedId)
    expect(tabs.tabs[0].conversation.sessionId).toBe(scopedId)
  })

  it('过滤不属于当前项目的文件和运行时 Tab，并给保留 Tab 写入 owner', () => {
    const workspaceRef = localWorkspaceRef('/workspace/a')
    const scoped = scopeWorkspaceTabSnapshot(
      {
        tabs: [
          {
            id: 'editor-a',
            type: 'editor',
            title: 'A',
            icon: 'doc',
            filePath: '/workspace/a/a.md',
          },
          {
            id: 'editor-b',
            type: 'editor',
            title: 'B',
            icon: 'doc',
            filePath: '/workspace/b/b.md',
          },
          {
            id: 'terminal-b',
            type: 'terminal',
            title: 'Terminal B',
            icon: 'terminal',
            terminal: {
              runtime: {
                workspaceRef: localWorkspaceRef('/workspace/b'),
              },
            },
          },
          {
            id: 'browser-b',
            type: 'browser',
            title: 'Browser B',
            icon: 'browser',
            workspaceRef: localWorkspaceRef('/workspace/b'),
          },
          {
            id: 'legacy-browser',
            type: 'browser',
            title: 'Legacy Browser',
            icon: 'browser',
          },
        ],
        activeTabId: 'editor-b',
      },
      new Map(),
      workspaceRef,
    ) as {
      tabs: Array<{ id: string; workspaceRef: WorkspaceRef }>
      activeTabId: string | null
    }

    expect(scoped.tabs.map((tab) => tab.id)).toEqual(['editor-a'])
    expect(scoped.tabs[0].workspaceRef).toEqual(workspaceRef)
    expect(scoped.activeTabId).toBe('editor-a')
  })

  it('过滤错误绑定的会话、浏览器状态和项目外草稿', () => {
    const workspaceRef = localWorkspaceRef('/workspace/a')
    const scopedAgent = scopeWorkspaceAgentSnapshot(
      {
        conversations: {
          keep: {
            id: 'keep',
            runtime: { workspaceRef },
          },
          drop: {
            id: 'drop',
            runtime: { workspaceRef: localWorkspaceRef('/workspace/b') },
          },
        },
        conversationOrder: ['keep', 'drop'],
        activeConversationId: 'drop',
      },
      workspaceRef,
    )
    const scopedTabs = scopeWorkspaceTabSnapshot(
      {
        tabs: [
          {
            id: 'browser-a',
            type: 'browser',
            workspaceRef,
          },
          {
            id: 'browser-b',
            type: 'browser',
            workspaceRef: localWorkspaceRef('/workspace/b'),
          },
        ],
        activeTabId: 'browser-b',
      },
      scopedAgent.conversationIdMap,
      workspaceRef,
    )
    const scopedBrowser = scopeWorkspaceBrowserSnapshot(
      {
        tabs: {
          'browser-a': { url: 'https://a.example' },
          'browser-b': { url: 'https://b.example' },
        },
      },
      scopedTabs,
    ) as { tabs: Record<string, unknown> }
    const scopedDrafts = scopeWorkspaceEditorDraftSnapshot(
      {
        files: {
          '/workspace/a/a.md': { dirty: true },
          '/workspace/b/b.md': { dirty: true },
          'virtual:draft': { dirty: true },
        },
      },
      workspaceRef,
    ) as { files: Record<string, unknown> }

    expect(Object.keys((scopedAgent.value as { conversations: object }).conversations)).toEqual([
      'keep',
    ])
    expect(
      (scopedAgent.value as { activeConversationId: string | null }).activeConversationId,
    ).toBeNull()
    expect((scopedTabs as { tabs: Array<{ id: string }> }).tabs.map((tab) => tab.id)).toEqual([
      'browser-a',
    ])
    expect(Object.keys(scopedBrowser.tabs)).toEqual(['browser-a'])
    expect(Object.keys(scopedDrafts.files)).toEqual(['/workspace/a/a.md', 'virtual:draft'])
  })
})
