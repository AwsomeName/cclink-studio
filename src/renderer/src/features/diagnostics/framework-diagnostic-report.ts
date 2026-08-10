import type { WorkspaceStateDiagnostics } from '@shared/ipc/workspace-state'
import { sanitizeDiagnosticText, type DiagnosticLogSnapshot } from '@shared/diagnostics'
import { workspaceRefKey } from '@shared/workspace-ref'
import { APP_VERSION } from '../../app-metadata'
import { useFsStore, useTabStore, useUpdateStore, useWorkspaceStore } from '../../stores'
import {
  formatContextActionDiagnosticsMarkdown,
  useContextActionDiagnosticsStore,
} from '../context-actions/context-action-diagnostics'
import {
  getMarkdownDiagnosticReport,
  getRendererDiagnosticLogSnapshot,
} from './renderer-diagnostic-log'

interface DiagnosticSection {
  title: string
  body: string
}

const MAX_SECTION_LENGTH = 100_000
const MAX_LOG_ENTRIES = 200

/**
 * 采集工作台框架诊断。这里故意不读取 Agent store、会话正文、思考过程或工具结果；
 * Agent 面板有独立的诊断入口，两个报告不能互相兜底混入对方的数据。
 */
export async function collectFrameworkDiagnosticReport(): Promise<string> {
  const [workspaceSection, credentialSection, scheduledTaskSection, mainLogSection] =
    await Promise.all([
      collectSection('工作台状态文件', async () =>
        formatFrameworkWorkspaceDiagnostics(await window.cclinkStudio.workspaceState.diagnostics()),
      ),
      collectSection('本地凭证状态', async () => {
        const status = await window.cclinkStudio.credentials.getStatus()
        return [
          `- 状态：${status.status}`,
          `- 文件：${status.filePath}`,
          `- 已配置：${status.configuredCount}`,
          `- 旧版加密文件：${status.legacyEncryptedFiles.length}`,
          ...(status.message ? [`- 提示：${status.message}`] : []),
        ].join('\n')
      }),
      collectSection('定时任务框架', async () => {
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
      collectSection('主进程近期框架日志', async () =>
        formatFrameworkLogSnapshot(await window.cclinkStudio.diagnostics.getMainLogSnapshot()),
      ),
    ])

  const runtimeSection = collectSyncSection('当前工作台运行状态', formatRuntimeState)
  const contextActionSection = collectSyncSection('上下文操作', () =>
    formatContextActionDiagnosticsMarkdown(useContextActionDiagnosticsStore.getState().events),
  )
  const rendererLogSection = collectSyncSection('界面近期框架日志', () =>
    formatFrameworkLogSnapshot(getRendererDiagnosticLogSnapshot()),
  )
  const markdownSection = collectSyncSection('Markdown 编辑器', () => {
    const activeTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId)
    const record = getMarkdownDiagnosticReport(activeTab?.filePath ?? null)
    if (!record) return '- 当前没有 Markdown 失败诊断记录'
    return [
      `- 记录时间：${record.updatedAt}`,
      `- 文件：${record.filePath ?? '未绑定文件'}`,
      '',
      record.report,
    ].join('\n')
  })

  const sections = [
    runtimeSection,
    workspaceSection,
    credentialSection,
    scheduledTaskSection,
    markdownSection,
    contextActionSection,
    rendererLogSection,
    mainLogSection,
  ]

  return [
    '# CCLink Studio 框架诊断日志',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 应用版本：${APP_VERSION}`,
    `- 平台：${navigator.userAgent || navigator.platform || 'unknown'}`,
    '- 范围：仅工作台框架；不包含 Agent 会话正文、思考过程、工具参数或工具结果。',
    '- 隐私：已隐藏用户主目录、凭证字段、Bearer 凭证和 URL 查询参数；各章节均有长度上限。',
    ...sections.flatMap((section) => [
      '',
      `## ${section.title}`,
      limitSection(sanitizeDiagnosticText(section.body, MAX_SECTION_LENGTH)),
    ]),
  ].join('\n')
}

function formatRuntimeState(): string {
  const fs = useFsStore.getState()
  const tabState = useTabStore.getState()
  const workspace = useWorkspaceStore.getState()
  const update = useUpdateStore.getState().snapshot
  const frameworkTabs = tabState.tabs.filter((tab) => tab.type !== 'conversation')
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId)
  const tabTypeCounts = frameworkTabs.reduce<Record<string, number>>((counts, tab) => {
    counts[tab.type] = (counts[tab.type] ?? 0) + 1
    return counts
  }, {})

  return [
    `- 工作空间：${workspaceRefKey(workspace.activeWorkspaceRef) ?? '未归档'}`,
    `- 文件系统：loading=${fs.loading} picking=${fs.picking} switching=${fs.switchingPath ?? '无'}`,
    `- 项目错误：${fs.error ?? '无'}`,
    `- 文件操作错误：${fs.operationError ?? '无'}`,
    `- 文件树：根节点=${fs.tree.length} 已展开=${fs.expandedPaths.length} 最近项目=${fs.recentWorkspacePaths.length}`,
    `- 非 Agent Tab：总数=${frameworkTabs.length} 类型=${JSON.stringify(tabTypeCounts)}`,
    `- 当前 Tab：${activeTab?.type === 'conversation' ? 'Agent（细节已省略）' : (activeTab?.type ?? '无')}`,
    `- 更新：phase=${update.phase} error=${update.error ?? '无'}`,
  ].join('\n')
}

function formatFrameworkWorkspaceDiagnostics(diagnostics: WorkspaceStateDiagnostics): string {
  return [
    `- userData：${diagnostics.userDataPath}`,
    `- workspace-state：${diagnostics.stateFilePath}`,
    `- backup：${diagnostics.backupFilePath}`,
    `- workspaceCount：${diagnostics.workspaceCount}`,
    `- fileVersion：${diagnostics.fileVersion}`,
    `- fixedUserDataPath：${diagnostics.userData?.fixedUserDataPath ?? '无'}`,
    '- Agent 会话恢复轨迹：已从框架报告排除，请使用 Agent 面板诊断入口',
  ].join('\n')
}

function formatFrameworkLogSnapshot(snapshot: DiagnosticLogSnapshot): string {
  const entries = snapshot.entries.filter((entry) => !isAgentRuntimeLog(entry.message))
  const lines = [
    `- 截止时间：${snapshot.capturedAt}`,
    `- 当前保留（过滤后）：${entries.length}`,
    `- 已丢弃旧记录：${snapshot.droppedCount}`,
    '- Agent/MCP 运行日志：已过滤',
  ]
  if (entries.length === 0) {
    lines.push('- 暂无框架日志')
    return lines.join('\n')
  }
  for (const entry of entries.slice(-MAX_LOG_ENTRIES)) {
    lines.push(
      `- ${entry.timestamp} · ${entry.level} · ${entry.source} · ${entry.message.replace(/\s+/g, ' ')}`,
    )
  }
  return lines.join('\n')
}

function isAgentRuntimeLog(message: string): boolean {
  return /\[(?:ClaudeCodeBackend|AgentBridge|McpToolHost|McpClientManager|PermissionManager)\]|\[CCLink Studio\].*\b(?:Agent|MCP)\b/i.test(
    message,
  )
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

function limitSection(value: string): string {
  return value.length <= MAX_SECTION_LENGTH
    ? value
    : `${value.slice(0, MAX_SECTION_LENGTH)}\n\n[本章节已截断]`
}

function formatCollectionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
