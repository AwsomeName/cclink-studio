import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RemoteStatus } from '@shared/remote-protocol'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import {
  resolveRemoteAgentVisualStatus,
  resolveRemoteStopAvailability,
  submitRemoteDraft,
  toUnifiedRemoteMessage,
  tryAcquireRemoteSubmissionLock,
} from './remote-agent-controller'
import { ConversationMessageRenderer } from '../../components/common/ConversationMessageRenderer'

const workspaceRef: RemoteWorkspaceRef = {
  kind: 'remote',
  transport: 'cclink',
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/workspace',
}

const onlineStatus: RemoteStatus = {
  ref: workspaceRef,
  state: 'online',
  compatibility: 'compatible',
  workspacePath: workspaceRef.path,
  capabilities: {
    file: { tree: true, read: true, write: true, create: true, rename: true, delete: true },
    shell: { pty: true },
    agent: { session: true, stream: true },
  },
}

beforeAll(() => {
  vi.stubGlobal('React', React)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('RemoteAgentController', () => {
  it('exposes the active remote session as a working Agent state', () => {
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: null,
        remoteStatus: onlineStatus,
        sessionStatus: 'active',
      }),
    ).toEqual({
      tone: 'working',
      label: 'Agent 正在工作',
      detail: '正在处理当前会话',
    })
  })

  it('distinguishes ready, connecting, and unavailable states', () => {
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: null,
        remoteStatus: onlineStatus,
        sessionStatus: 'idle',
      }).label,
    ).toBe('Agent 就绪')
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: null,
        remoteStatus: null,
      }).label,
    ).toBe('Agent 连接中')
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: '连接失败',
        remoteStatus: null,
      }),
    ).toMatchObject({ tone: 'unavailable', label: 'Agent 不可用', detail: '连接失败' })
  })

  it('does not report ready when streaming is unavailable or the protocol needs an upgrade', () => {
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: null,
        remoteStatus: {
          ...onlineStatus,
          capabilities: {
            ...onlineStatus.capabilities,
            agent: { session: true, stream: false },
          },
        },
      }),
    ).toMatchObject({ tone: 'unavailable', label: 'Agent 不可用' })
    expect(
      resolveRemoteAgentVisualStatus({
        statusError: null,
        remoteStatus: { ...onlineStatus, compatibility: 'upgrade-required' },
      }),
    ).toMatchObject({ tone: 'unavailable', label: 'Agent 需升级' })
  })

  it('keeps the expected stop control visible but disabled while remote work is active', () => {
    expect(resolveRemoteStopAvailability('active')).toEqual({
      state: 'disabled',
      reason: '当前远程 Agent 不支持停止',
    })
    expect(resolveRemoteStopAvailability('idle')).toEqual({ state: 'hidden' })
  })

  it('rejects a consecutive remote submit until the active submission releases its lock', () => {
    const lock = { current: false }

    expect(tryAcquireRemoteSubmissionLock(lock)).toBe(true)
    expect(tryAcquireRemoteSubmissionLock(lock)).toBe(false)
    lock.current = false
    expect(tryAcquireRemoteSubmissionLock(lock)).toBe(true)
  })

  it('uses the same user and assistant message surfaces as local conversations', () => {
    const userHtml = renderToStaticMarkup(
      <ConversationMessageRenderer
        message={toUnifiedRemoteMessage({
          type: 'user',
          id: 'user-1',
          content: '总结一下项目',
          timestamp: 1,
        })}
        conversationId="session-1"
        workspaceKey="remote"
      />,
    )
    const assistantHtml = renderToStaticMarkup(
      <ConversationMessageRenderer
        message={toUnifiedRemoteMessage({
          type: 'agentText',
          id: 'agent-1',
          content: '## 结论',
          timestamp: 2,
        })}
        conversationId="session-1"
        workspaceKey="remote"
      />,
    )

    expect(userHtml).toContain('class="agent-message user ')
    expect(assistantHtml).toContain('class="agent-message assistant ')
    expect(assistantHtml).toContain('<h2>结论</h2>')
    expect(`${userHtml}${assistantHtml}`).not.toContain('remote-agent-message')
  })

  it('renders remote tool output with the local collapsible tool treatment', () => {
    const html = renderToStaticMarkup(
      <ConversationMessageRenderer
        message={toUnifiedRemoteMessage({
          type: 'agentTool',
          id: 'tool-message-1',
          timestamp: 3,
          tool: {
            id: 'tool-1',
            name: 'Bash',
            state: 'completed',
            input: { command: 'ls' },
            output: 'README.md\nsrc',
          },
        })}
        conversationId="session-1"
        workspaceKey="remote"
      />,
    )

    expect(html).toContain('class="content-tool-group"')
    expect(html).toContain('class="tool-group-row tool-group-row-use ')
    expect(html).toContain('class="tool-group-row tool-group-row-result success"')
    expect(html).toContain('<details')
    expect(html).not.toContain('Bashcompleted')
  })

  it('fails closed before creating or sending when the captured workspace target is stale', async () => {
    const createSession = vi.fn()
    const selectSession = vi.fn()
    const sendAgentMessage = vi.fn()

    await expect(
      submitRemoteDraft({
        target: { ref: workspaceRef, generation: 1 },
        workspaceRef,
        activeSession: null,
        content: '不应发送',
        isTargetCurrent: () => false,
        createSession,
        selectSession,
        sendAgentMessage,
      }),
    ).resolves.toBe('stale-target')

    expect(createSession).not.toHaveBeenCalled()
    expect(selectSession).not.toHaveBeenCalled()
    expect(sendAgentMessage).not.toHaveBeenCalled()
  })

  it('keeps a newly created idle session but does not send after the target becomes stale', async () => {
    const session = {
      id: 'session-created',
      serverId: workspaceRef.endpointId,
      workspaceId: workspaceRef.workspaceId,
      workspacePath: workspaceRef.path,
      name: '新远程会话',
      status: 'idle' as const,
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
      contextUsage: 0,
    }
    let validationCount = 0
    const selectSession = vi.fn()
    const sendAgentMessage = vi.fn()

    await expect(
      submitRemoteDraft({
        target: { ref: workspaceRef, generation: 1 },
        workspaceRef,
        activeSession: null,
        content: '切换期间不发送',
        isTargetCurrent: () => ++validationCount === 1,
        createSession: vi.fn().mockResolvedValue(session),
        selectSession,
        sendAgentMessage,
      }),
    ).resolves.toBe('stale-target')

    expect(selectSession).not.toHaveBeenCalled()
    expect(sendAgentMessage).not.toHaveBeenCalled()
  })

  it('submits only through the captured remote workspace and session owner', async () => {
    const session = {
      id: 'session-1',
      serverId: workspaceRef.endpointId,
      workspaceId: workspaceRef.workspaceId,
      workspacePath: workspaceRef.path,
      name: '远程会话',
      status: 'idle' as const,
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
      contextUsage: 0,
    }
    const selectSession = vi.fn()
    const sendAgentMessage = vi.fn().mockResolvedValue(true)

    await expect(
      submitRemoteDraft({
        target: { ref: workspaceRef, generation: 4 },
        workspaceRef,
        activeSession: session,
        content: '只发到远程',
        isTargetCurrent: () => true,
        createSession: vi.fn(),
        selectSession,
        sendAgentMessage,
      }),
    ).resolves.toBe('submitted')

    expect(selectSession).toHaveBeenCalledWith(session.id)
    expect(sendAgentMessage).toHaveBeenCalledWith(workspaceRef, session.id, '只发到远程')
  })

  it('never falls back to the local Agent when the remote send fails', async () => {
    const localAgentSendMessage = vi.fn()
    const remoteSend = vi.fn().mockRejectedValue(new Error('remote offline'))
    const session = {
      id: 'remote-session',
      serverId: workspaceRef.endpointId,
      workspaceId: workspaceRef.workspaceId,
      workspacePath: workspaceRef.path,
      name: '远程会话',
      status: 'idle' as const,
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
      contextUsage: 0,
    }

    await expect(
      submitRemoteDraft({
        target: { ref: workspaceRef, generation: 1 },
        workspaceRef,
        activeSession: session,
        content: '只允许远程发送',
        isTargetCurrent: () => true,
        createSession: vi.fn(),
        selectSession: vi.fn(),
        sendAgentMessage: remoteSend,
      }),
    ).resolves.toBe('rejected')

    expect(remoteSend).toHaveBeenCalledTimes(1)
    expect(localAgentSendMessage).toHaveBeenCalledTimes(0)
  })
})
