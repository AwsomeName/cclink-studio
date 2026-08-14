import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useFsStore, useTabStore, useWorkspaceStore } from '../../stores'
import {
  recordRendererDiagnosticLog,
  resetRendererDiagnosticsForTest,
} from './renderer-diagnostic-log'
import { collectFrameworkDiagnosticReport } from './framework-diagnostic-report'

describe('collectFrameworkDiagnosticReport', () => {
  beforeEach(() => {
    resetRendererDiagnosticsForTest()
    vi.stubGlobal('navigator', {
      userAgent: 'CCLink Framework Test',
      platform: 'darwin',
    })
    useWorkspaceStore.setState({ activeWorkspaceRef: localWorkspaceRef('/Users/alice/project') })
    useFsStore.setState({
      workspacePath: '/Users/alice/project',
      loading: false,
      picking: false,
      switchingPath: null,
      error: '打开项目失败: EACCES',
      operationError: null,
      tree: [],
      expandedPaths: [],
      recentWorkspacePaths: ['/Users/alice/project'],
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('collects framework state and filters Agent runtime logs', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          diagnostics: vi.fn().mockResolvedValue({
            userDataPath: '/Users/alice/Library/Application Support/CCLink',
            stateFilePath: '/Users/alice/workspace-state.json',
            backupFilePath: '/Users/alice/workspace-state.backup.json',
            workspaceCount: 2,
            fileVersion: 1,
            userData: { fixedUserDataPath: '/Users/alice/cclink-user-data' },
            recoveryTrace: {
              filePath: '/Users/alice/agent-recovery.json',
              retainedEntries: 1,
              droppedCount: 0,
              entries: [],
            },
          }),
        },
        diagnostics: {
          getMainLogSnapshot: vi.fn().mockResolvedValue({
            capturedAt: '2026-08-11T10:00:00.000Z',
            entries: [
              {
                timestamp: '2026-08-11T09:58:00.000Z',
                level: 'error',
                source: 'main',
                message: '[WorkspaceStateService] project open failed',
              },
              {
                timestamp: '2026-08-11T09:59:00.000Z',
                level: 'error',
                source: 'main',
                message: '[ClaudeCodeBackend] agent-private-log',
              },
            ],
            droppedCount: 0,
          }),
        },
        credentials: {
          getStatus: vi.fn().mockResolvedValue({
            status: 'ready',
            filePath: '/Users/alice/credentials.json',
            configuredCount: 1,
            legacyEncryptedFiles: [],
          }),
        },
        scheduledTasks: {
          getRuntimeStatus: vi.fn().mockResolvedValue({
            state: 'ready',
            startedAt: 1,
            timerDueAt: null,
            queuedCount: 0,
            runningRunId: null,
            enabledCount: 0,
            systemScheduler: 'none',
          }),
        },
      },
    })
    recordRendererDiagnosticLog('error', ['[FsStore] 打开所选项目失败: EACCES'])
    recordRendererDiagnosticLog('error', ['[AgentBridge] agent-renderer-private-log'])

    const report = await collectFrameworkDiagnosticReport()

    expect(report).toContain('# CCLink Studio 框架诊断日志')
    expect(report).toContain('打开项目失败: EACCES')
    expect(report).toContain('[WorkspaceStateService] project open failed')
    expect(report).toContain('[FsStore] 打开所选项目失败: EACCES')
    expect(report).toContain('Agent 会话恢复轨迹：已从框架报告排除')
    expect(report).not.toContain('agent-private-log')
    expect(report).not.toContain('agent-renderer-private-log')
    expect(report).not.toContain('agent-recovery.json')
    expect(report).not.toContain('/Users/alice')
  })

  it('keeps the remaining report when IPC diagnostic sources fail', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          diagnostics: vi.fn().mockRejectedValue(new Error('workspace unavailable')),
        },
        diagnostics: {
          getMainLogSnapshot: vi.fn().mockRejectedValue(new Error('main unavailable')),
        },
        credentials: {
          getStatus: vi.fn().mockRejectedValue(new Error('credentials unavailable')),
        },
        scheduledTasks: {
          getRuntimeStatus: vi.fn().mockRejectedValue(new Error('scheduler unavailable')),
        },
      },
    })

    const report = await collectFrameworkDiagnosticReport()

    expect(report).toContain('## 当前工作台运行状态')
    expect(report).toContain('- 采集失败：workspace unavailable')
    expect(report).toContain('- 采集失败：main unavailable')
    expect(report).toContain('- 采集失败：credentials unavailable')
    expect(report).toContain('- 采集失败：scheduler unavailable')
  })

  it('includes the complete correlated capability response for an active remote workspace', async () => {
    const ref = remoteWorkspaceRef({
      endpointId: 'agent-1',
      workspaceId: 'ws-canonical',
      path: '/srv/project',
    })
    useWorkspaceStore.setState({ activeWorkspaceRef: ref })
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          diagnostics: vi.fn().mockRejectedValue(new Error('workspace unavailable')),
        },
        diagnostics: {
          getMainLogSnapshot: vi.fn().mockRejectedValue(new Error('main unavailable')),
        },
        credentials: {
          getStatus: vi.fn().mockRejectedValue(new Error('credentials unavailable')),
        },
        scheduledTasks: {
          getRuntimeStatus: vi.fn().mockRejectedValue(new Error('scheduler unavailable')),
        },
        remote: {
          diagnose: vi.fn().mockResolvedValue({
            ref,
            generatedAt: 1,
            checks: [],
            recentErrors: [],
            status: {
              ref,
              state: 'online',
              endpointName: 'supermicro',
              agentVersion: '0.8.41',
              protocolVersion: '2',
              compatibility: 'compatible',
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
                agent: { session: true, stream: true },
              },
              capabilityProbe: {
                state: 'unknown',
                stale: false,
                response: {
                  cc_type: 'capability_probe_response',
                  v: 2,
                  min_v: 2,
                  request_id: 'probe-request',
                  trace_id: 'probe-trace',
                  sender: {
                    kind: 'agent',
                    version: '0.8.41',
                    capabilities: ['file_tree', 'stream_json_input', 'runtime_select'],
                  },
                  payload_truncated: true,
                },
              },
            },
          }),
        },
      },
    })

    const report = await collectFrameworkDiagnosticReport()

    expect(report).toContain('## 当前远程能力探测')
    expect(report).toContain('"cc_type": "capability_probe_response"')
    expect(report).toContain('"request_id": "probe-request"')
    expect(report).toContain('"trace_id": "probe-trace"')
    expect(report).toContain('"stream_json_input"')
    expect(report).toContain('"payload_truncated": true')
  })
})
