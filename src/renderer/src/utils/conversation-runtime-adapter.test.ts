import { describe, expect, it } from 'vitest'
import type { ChatccServer, ChatccSession } from '@shared/chatcc'
import type { AgentConversationState } from '../stores/agent-store'
import {
  getCclinkConversationMeta,
  getLocalAgentConversationMeta,
  getUnsupportedConversationMeta,
} from './conversation-runtime-adapter'

function localConversation(
  overrides: Partial<AgentConversationState> = {},
): AgentConversationState {
  return {
    id: 'agent-1',
    title: '新会话',
    surface: 'workbench-tab',
    runtime: {
      location: 'local',
      transport: 'local',
      backend: 'deepink-agent',
    },
    messages: [],
    input: '',
    loading: false,
    backendState: 'connected',
    sessionId: 'session-local-1',
    streamingMessageId: null,
    lastCost: null,
    scope: { kind: 'all' },
    mountedResources: [],
    mountedSkills: [],
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  }
}

const server: ChatccServer = {
  id: 'server-1',
  name: 'supermicro',
  hostname: 'supermicro',
  os: 'Linux',
  status: 'online',
  agentVersion: '1.0.0',
  claudeVersion: '1.0.0',
  lastSeen: 1,
  workspaces: [],
}

const session: ChatccSession = {
  id: 'remote-session-1',
  name: '远程任务',
  workspacePath: '/data/project',
  serverId: 'server-1',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
  contextUsage: 0,
}

describe('conversation-runtime-adapter', () => {
  it('生成本地 Agent 工作会话元信息', () => {
    expect(
      getLocalAgentConversationMeta(localConversation(), '本地 · DeepInk', ['本地', 'Local']),
    ).toEqual({
      kind: 'local-agent',
      title: '新工作会话',
      subtitle: '本地 · DeepInk',
      chips: ['本地', 'Local', 'DeepInk Agent', 'Session session-'],
      badge: '可对话',
      status: 'ready',
    })
  })

  it('本地 Agent 执行中状态映射为 busy', () => {
    const meta = getLocalAgentConversationMeta(
      localConversation({ loading: true, backendState: 'streaming' }),
      '本地 · DeepInk',
      ['本地', 'Local'],
    )

    expect(meta.badge).toBe('执行中')
    expect(meta.status).toBe('busy')
  })

  it('已归档本地会话优先标记为 archived', () => {
    const meta = getLocalAgentConversationMeta(
      localConversation({ archivedAt: 1, loading: true, backendState: 'streaming' }),
      '本地 · DeepInk',
      ['本地', 'Local'],
    )

    expect(meta.badge).toBe('已归档')
    expect(meta.status).toBe('archived')
  })

  it('生成 CCLink 在线远程会话元信息', () => {
    expect(getCclinkConversationMeta(session, server)).toEqual({
      kind: 'remote-cclink',
      title: '远程任务',
      subtitle: 'supermicro · /data/project',
      chips: ['远程', 'CCLink', '设备在线'],
      badge: '在线',
      status: 'ready',
    })
  })

  it('CCLink 离线或缺服务器时标记为本地缓存', () => {
    expect(getCclinkConversationMeta(session, null)).toMatchObject({
      badge: '本地缓存',
      status: 'cached',
    })
  })

  it('生成 unsupported 会话元信息', () => {
    expect(
      getUnsupportedConversationMeta({
        kind: 'unsupported',
        tabId: 'tab-direct',
        reason: '暂不支持 remote/direct 会话 Tab',
      }),
    ).toEqual({
      kind: 'unsupported',
      title: '这个会话暂时打不开',
      reason: '暂不支持 remote/direct 会话 Tab',
    })
  })
})
