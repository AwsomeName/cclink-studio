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

  it('设备在线时把能力错误归到能力检查，不污染连接检查', () => {
    const ref = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    })
    const remoteError = {
      layer: 'transport' as const,
      code: 'REMOTE_REQUEST_TIMEOUT',
      message: '等待能力探测响应超时',
      retryable: true,
      context: { operation: 'capability.probe' },
    }
    const report = buildRemoteDiagnosticReport(
      {
        ref,
        state: 'online',
        compatibility: 'unknown',
        workspacePath: ref.path,
        capabilities: {
          file: {
            tree: false,
            read: false,
            write: false,
            create: false,
            rename: false,
            delete: false,
          },
          shell: { pty: false },
          agent: { session: false, stream: false },
        },
        remoteError,
      },
      [],
    )

    expect(report.checks.find((check) => check.id === 'connection')).toMatchObject({
      status: 'pass',
      message: '远程设备在线',
    })
    expect(report.checks.find((check) => check.id === 'connection')?.remoteError).toBeUndefined()
    expect(report.checks.find((check) => check.id === 'capability.agent.session')).toMatchObject({
      status: 'warn',
      message: '等待能力探测响应超时',
      remoteError: { code: 'REMOTE_REQUEST_TIMEOUT' },
    })
    expect(report.recentErrors).toEqual([])
  })
})
