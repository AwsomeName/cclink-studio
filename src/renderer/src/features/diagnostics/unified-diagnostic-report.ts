import type { DiagnosticLogSnapshot } from '@shared/diagnostics'
import { sanitizeDiagnosticText } from '@shared/diagnostics'
import { APP_VERSION } from '../../app-metadata'
import {
  formatContextActionDiagnosticsMarkdown,
  useContextActionDiagnosticsStore,
} from '../context-actions/context-action-diagnostics'
import { formatWorkspaceDiagnosticsMarkdown } from '../../utils/workspace-diagnostics'
import {
  getMarkdownDiagnosticReport,
  getRendererDiagnosticLogSnapshot,
} from './renderer-diagnostic-log'

interface UnifiedDiagnosticReportInput {
  agentReport: string
  activeFilePath?: string | null
}

interface DiagnosticSection {
  title: string
  body: string
}

const MAX_SECTION_LENGTH = 100_000
const MAX_LOG_ENTRIES = 100

export async function collectUnifiedDiagnosticReport(
  input: UnifiedDiagnosticReportInput,
): Promise<string> {
  const [workspaceSection, credentialSection, scheduledTaskSection, mainLogSection] =
    await Promise.all([
      collectSection('工作台状态', async () => {
        const diagnostics = await window.cclinkStudio.workspaceState.diagnostics()
        return formatWorkspaceDiagnosticsMarkdown(diagnostics)
      }),
      collectSection('本地凭证', async () => {
        const status = await window.cclinkStudio.credentials.getStatus()
        return [
          `- 状态：${status.status}`,
          `- 文件：${status.filePath}`,
          `- 已配置：${status.configuredCount}`,
          `- 旧版加密文件：${status.legacyEncryptedFiles.length}`,
          ...(status.message ? [`- 提示：${status.message}`] : []),
        ].join('\n')
      }),
      collectSection('定时任务', async () => {
        const status = await window.cclinkStudio.scheduledTasks.getRuntimeStatus()
        return [
          `- Scheduler：${status.state}`,
          `- 启动时间：${status.startedAt ?? '未启动'}`,
          `- 最近 timer：${status.timerDueAt ?? '无'}`,
          `- 排队数量：${status.queuedCount}`,
          `- 当前运行：${status.runningRunId ?? '无'}`,
          `- 已启用任务：${status.enabledCount}`,
          `- 系统调度配置：${status.systemScheduler}`,
          ...(status.lastError
            ? [`- 最近失败：${status.lastError.code} · ${status.lastError.message}`]
            : []),
        ].join('\n')
      }),
      collectSection('主进程近期日志', async () =>
        formatLogSnapshot(await window.cclinkStudio.diagnostics.getMainLogSnapshot()),
      ),
    ])

  const contextActionSection = collectSyncSection('上下文操作', () =>
    formatContextActionDiagnosticsMarkdown(useContextActionDiagnosticsStore.getState().events),
  )
  const rendererLogSection = collectSyncSection('Renderer 近期日志', () =>
    formatLogSnapshot(getRendererDiagnosticLogSnapshot()),
  )
  const markdownSection = collectSyncSection('Markdown', () => {
    const record = getMarkdownDiagnosticReport(input.activeFilePath)
    if (!record) return '- 当前没有 Markdown 失败诊断记录'
    return [
      `- 记录时间：${record.updatedAt}`,
      `- 文件：${record.filePath ?? '未绑定文件'}`,
      '',
      record.report,
    ].join('\n')
  })

  const sections: DiagnosticSection[] = [
    {
      title: 'Agent 与当前会话',
      body: input.agentReport || '- Agent 诊断未生成',
    },
    workspaceSection,
    credentialSection,
    scheduledTaskSection,
    markdownSection,
    contextActionSection,
    rendererLogSection,
    mainLogSection,
  ]

  return [
    '# CCLink Studio 完整诊断日志',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 应用版本：${APP_VERSION}`,
    `- 平台：${navigator.userAgent || navigator.platform || 'unknown'}`,
    '- 隐私：已隐藏用户主目录、凭证字段、Bearer 凭证和 URL 查询参数；各章节均有长度上限。',
    ...sections.flatMap((section) => [
      '',
      `## ${section.title}`,
      limitSection(sanitizeDiagnosticText(section.body, MAX_SECTION_LENGTH)),
    ]),
  ].join('\n')
}

async function collectSection(
  title: string,
  collect: () => Promise<string>,
): Promise<DiagnosticSection> {
  try {
    return { title, body: await collect() }
  } catch (error) {
    return { title, body: `- 采集失败：${formatCollectionError(error)}` }
  }
}

function collectSyncSection(title: string, collect: () => string): DiagnosticSection {
  try {
    return { title, body: collect() }
  } catch (error) {
    return { title, body: `- 采集失败：${formatCollectionError(error)}` }
  }
}

function formatLogSnapshot(snapshot: DiagnosticLogSnapshot): string {
  const lines = [
    `- 截止时间：${snapshot.capturedAt}`,
    `- 当前保留：${snapshot.entries.length}`,
    `- 已丢弃旧记录：${snapshot.droppedCount}`,
  ]
  if (snapshot.entries.length === 0) {
    lines.push('- 暂无日志')
    return lines.join('\n')
  }
  for (const entry of snapshot.entries.slice(-MAX_LOG_ENTRIES)) {
    lines.push(
      `- ${entry.timestamp} · ${entry.level} · ${entry.source} · ${entry.message.replace(/\s+/g, ' ')}`,
    )
  }
  return lines.join('\n')
}

function limitSection(value: string): string {
  return value.length <= MAX_SECTION_LENGTH
    ? value
    : `${value.slice(0, MAX_SECTION_LENGTH)}\n\n[本章节已截断]`
}

function formatCollectionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
