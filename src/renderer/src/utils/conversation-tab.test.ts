import { describe, expect, it } from 'vitest'
import type { Tab } from '../types'
import { resolveConversationTab } from './conversation-tab'

describe('resolveConversationTab', () => {
  it('解析本地工作会话 Tab', () => {
    const tab: Tab = {
      id: 'tab-local',
      type: 'conversation',
      title: '本地会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'deepink-agent',
        },
        sessionId: 'agent-1',
      },
    }

    expect(resolveConversationTab(tab)).toEqual({
      kind: 'local-agent',
      tabId: 'tab-local',
      conversationId: 'agent-1',
    })
  })

  it('将 CCLink 远程会话 Tab 降级为 unsupported', () => {
    const tab: Tab = {
      id: 'tab-cclink',
      type: 'conversation',
      title: '远程会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'remote',
          transport: 'cclink',
          backend: 'deepink-agent',
        },
        sessionId: 'remote-1',
      },
    }

    expect(resolveConversationTab(tab)).toEqual({
      kind: 'unsupported',
      tabId: 'tab-cclink',
      reason: '暂不支持 remote/cclink 会话 Tab',
    })
  })

  it('将旧 cclink Tab 降级为 unsupported', () => {
    const tab: Tab = {
      id: 'tab-legacy',
      type: 'cclink',
      title: '旧远程会话',
      icon: '🔗',
      cclinkSessionId: 'legacy-1',
    }

    expect(resolveConversationTab(tab)).toEqual({
      kind: 'unsupported',
      tabId: 'tab-legacy',
      reason: '开源壳不加载旧 CCLink 会话模块',
    })
  })

  it('对尚未接入的 direct 远程会话给出明确 unsupported', () => {
    const tab: Tab = {
      id: 'tab-direct',
      type: 'conversation',
      title: '直连会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'remote',
          transport: 'direct',
          backend: 'codex',
        },
        sessionId: 'direct-1',
      },
    }

    expect(resolveConversationTab(tab)).toEqual({
      kind: 'unsupported',
      tabId: 'tab-direct',
      reason: '暂不支持 remote/direct 会话 Tab',
    })
  })

  it('非会话 Tab 返回 null', () => {
    expect(
      resolveConversationTab({
        id: 'doc',
        type: 'editor',
        title: 'README.md',
        icon: '📄',
      }),
    ).toBeNull()
  })
})
