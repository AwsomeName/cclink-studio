import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RemoteStatus } from '@shared/remote-protocol'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { RemoteMessage, resolveRemoteAgentVisualStatus } from './RemoteAgentPanel'

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

describe('RemoteAgentPanel', () => {
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

  it('uses the same user and assistant message surfaces as local conversations', () => {
    const userHtml = renderToStaticMarkup(
      <RemoteMessage
        message={{ type: 'user', id: 'user-1', content: '总结一下项目', timestamp: 1 }}
        workspaceRef={workspaceRef}
        sessionId="session-1"
        reload={async () => undefined}
      />,
    )
    const assistantHtml = renderToStaticMarkup(
      <RemoteMessage
        message={{ type: 'agentText', id: 'agent-1', content: '## 结论', timestamp: 2 }}
        workspaceRef={workspaceRef}
        sessionId="session-1"
        reload={async () => undefined}
      />,
    )

    expect(userHtml).toContain('class="agent-message user"')
    expect(assistantHtml).toContain('class="agent-message assistant"')
    expect(assistantHtml).toContain('<h2>结论</h2>')
    expect(`${userHtml}${assistantHtml}`).not.toContain('remote-agent-message')
  })

  it('renders remote tool output with the local collapsible tool treatment', () => {
    const html = renderToStaticMarkup(
      <RemoteMessage
        message={{
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
        }}
        workspaceRef={workspaceRef}
        sessionId="session-1"
        reload={async () => undefined}
      />,
    )

    expect(html).toContain('class="content-tool-use"')
    expect(html).toContain('class="content-tool-result success"')
    expect(html).toContain('<details')
    expect(html).not.toContain('Bashcompleted')
  })
})
