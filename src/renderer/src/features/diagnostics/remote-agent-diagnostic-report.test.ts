import { describe, expect, it } from 'vitest'
import type { RemoteDiagnosticReport } from '@shared/remote-protocol'
import { buildRemoteAgentDiagnosticMarkdown } from './remote-agent-diagnostic-report'

const ref = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent-1',
  endpointName: 'supermicro',
  workspaceId: 'workspace-1',
  path: '/srv/project',
}

const report: RemoteDiagnosticReport = {
  ref,
  generatedAt: 1_700_000_000_000,
  status: {
    ref,
    state: 'online',
    agentVersion: '0.8.46',
    protocolVersion: '2',
    runtime: 'claude_code',
    compatibility: 'compatible',
    workspacePath: ref.path,
    capabilities: {
      file: { tree: true, read: true, write: true, create: true, rename: true, delete: true },
      shell: { pty: true },
      agent: { session: true, stream: true },
    },
  },
  checks: [{ id: 'agent', label: '远程 Agent 会话', status: 'pass', message: '可用' }],
  recentErrors: [],
  agentSession: {
    session: {
      id: 'session-1',
      name: '诊断会话',
      workspaceId: ref.workspaceId,
      workspacePath: ref.path,
      serverId: ref.endpointId,
      status: 'idle',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 2,
      contextUsage: 0,
    },
    messages: [
      { type: 'user', id: 'user-1', content: '检查 token=very-secret', timestamp: 1 },
      {
        type: 'agentTool',
        id: 'tool-1',
        timestamp: 2,
        tool: {
          id: 'use-1',
          name: 'Bash',
          state: 'failed',
          input: { command: 'pwd', apiKey: 'raw-key' },
          error: 'Bearer raw-bearer-value',
        },
      },
    ],
    messageLimit: 100,
    events: [
      {
        timestamp: 1_700_000_000_100,
        direction: 'inbound',
        type: 'stream_end',
        requestId: 'request-1',
        messageId: 'message-1',
        exitCode: 0,
        finalState: 'missing_final_diagnostic',
      },
    ],
    eventLimit: 100,
    processLocalOnly: true,
  },
}

describe('remote Agent diagnostic report', () => {
  it('explains the terminal event and redacts conversation/tool secrets', () => {
    const markdown = buildRemoteAgentDiagnosticMarkdown({
      appVersion: '0.1.42',
      platform: 'Linux',
      report,
    })

    expect(markdown).toContain(
      '已收到结束事件（stream_end · exit=0 · final_state=missing_final_diagnostic）',
    )
    expect(markdown).toContain('request=request-1')
    expect(markdown).toContain('tool=Bash · state=failed')
    expect(markdown).toContain('token=[REDACTED]')
    expect(markdown).toContain('"apiKey":"[REDACTED]"')
    expect(markdown).toContain('Bearer [REDACTED]')
    expect(markdown).not.toContain('very-secret')
    expect(markdown).not.toContain('raw-key')
    expect(markdown).not.toContain('raw-bearer-value')
  })

  it('states when Studio is idle without a captured end event', () => {
    const markdown = buildRemoteAgentDiagnosticMarkdown({
      appVersion: '0.1.42',
      platform: 'Linux',
      report: {
        ...report,
        agentSession: { ...report.agentSession!, events: [] },
      },
    })
    expect(markdown).toContain('Studio 显示已结束，但当前进程没有捕获结束事件')
  })
})
