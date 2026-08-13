import { describe, expect, it } from 'vitest'
import { remoteWorkspaceRef } from '../../shared/workspace-ref'
import { buildRemoteDiagnosticReport } from './remote-diagnostics'

describe('buildRemoteDiagnosticReport', () => {
  it('分别报告连接、协议和真实能力，不把在线等同于功能可用', () => {
    const ref = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    })
    const report = buildRemoteDiagnosticReport(
      {
        ref,
        state: 'online',
        compatibility: 'compatible',
        protocolVersion: '2',
        workspacePath: ref.path,
        capabilities: {
          file: {
            tree: true,
            read: true,
            write: false,
            create: false,
            rename: false,
            delete: false,
          },
          shell: { pty: false },
          agent: { session: false, stream: false },
        },
      },
      [],
    )

    expect(report.checks.find((check) => check.id === 'connection')?.status).toBe('pass')
    expect(report.checks.find((check) => check.id === 'capability.agent.session')?.status).toBe(
      'warn',
    )
    expect(report.checks.find((check) => check.id === 'capability.file.read')?.status).toBe('pass')
  })
})
