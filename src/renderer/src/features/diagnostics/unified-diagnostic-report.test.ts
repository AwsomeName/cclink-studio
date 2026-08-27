import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextActionDiagnosticsStore } from '../context-actions/context-action-diagnostics'
import {
  publishMarkdownDiagnosticReport,
  recordRendererDiagnosticLog,
  resetRendererDiagnosticsForTest,
} from './renderer-diagnostic-log'
import { collectUnifiedDiagnosticReport } from './unified-diagnostic-report'

describe('collectUnifiedDiagnosticReport', () => {
  beforeEach(() => {
    resetRendererDiagnosticsForTest()
    useContextActionDiagnosticsStore.getState().clear()
    vi.stubGlobal('navigator', {
      userAgent: 'CCLink Test',
      platform: 'darwin',
    })
  })

  it('combines all local diagnostic sources and redacts sensitive data', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          diagnostics: vi.fn().mockResolvedValue({
            userDataPath: '/Users/alice/Library/Application Support/CCLink',
            stateFilePath: '/Users/alice/state.json',
            backupFilePath: '/Users/alice/state.backup.json',
            workspaceCount: 2,
            fileVersion: 1,
            userData: { fixedUserDataPath: '/Users/alice/cclink-user-data' },
          }),
        },
        diagnostics: {
          getMainLogSnapshot: vi.fn().mockResolvedValue({
            capturedAt: '2026-07-26T10:00:00.000Z',
            entries: [
              {
                timestamp: '2026-07-26T09:59:00.000Z',
                level: 'error',
                source: 'main',
                message: 'authorization=raw-secret',
              },
            ],
            droppedCount: 3,
          }),
        },
        credentials: {
          getStatus: vi.fn().mockResolvedValue({
            status: 'ready',
            filePath:
              '/Users/alice/Library/Application Support/CCLink/credentials/credentials.json',
            configuredCount: 2,
            legacyEncryptedFiles: [],
          }),
        },
        scheduledTasks: {
          getRuntimeStatus: vi.fn().mockResolvedValue({
            state: 'ready',
            startedAt: 1,
            timerDueAt: 2,
            queuedCount: 0,
            runningRunId: null,
            enabledCount: 1,
            systemScheduler: 'none',
          }),
        },
      },
    })
    recordRendererDiagnosticLog('warn', ['renderer warning'])
    publishMarkdownDiagnosticReport({
      key: 'tab-md',
      filePath: '/Users/alice/project/note.md',
      report: 'markdown diagnostic',
    })
    useContextActionDiagnosticsStore.getState().record({
      kind: 'domain-execution-failed',
      commandId: 'file.rename',
      message: 'rename failed',
    })

    const report = await collectUnifiedDiagnosticReport({
      agentReport: 'agent diagnostic',
      activeFilePath: '/Users/alice/project/note.md',
    })

    expect(report).toContain('# CCLink Studio 完整诊断日志')
    expect(report).toContain('## Agent 与当前会话')
    expect(report).toContain('## 工作台状态')
    expect(report).toContain('## 本地凭证')
    expect(report).toContain('已配置：2')
    expect(report).toContain('## 定时任务')
    expect(report).toContain('系统调度配置：none')
    expect(report).toContain('## Markdown')
    expect(report).toContain('markdown diagnostic')
    expect(report).toContain('file.rename')
    expect(report).toContain('## 界面近期框架日志')
    expect(report).toContain('renderer warning')
    expect(report).toContain('## 主进程近期框架日志')
    expect(report).toContain('authorization=[REDACTED]')
    expect(report).toContain('已丢弃旧记录：3')
    expect(report).not.toContain('/Users/alice')
    expect(report).not.toContain('raw-secret')
  })

  it('reports a failed source without breaking the remaining report', async () => {
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

    const report = await collectUnifiedDiagnosticReport({
      agentReport: 'agent still available',
    })

    expect(report).toContain('agent still available')
    expect(report).toContain('- 采集失败：workspace unavailable')
    expect(report).toContain('- 采集失败：main unavailable')
    expect(report).toContain('- 采集失败：credentials unavailable')
    expect(report).toContain('- 采集失败：scheduler unavailable')
    expect(report).toContain('## 界面近期框架日志')
    expect(report).toContain('## 主进程近期框架日志')
  })
})
