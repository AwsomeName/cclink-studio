import type { WorkspaceStateDiagnostics } from '@shared/ipc/workspace-state'
import type { BrowserRuntimeDiagnosticSummary } from '@shared/ipc/browser'
import { sanitizeDiagnosticText, type DiagnosticLogSnapshot } from '@shared/diagnostics'
import { workspaceRefKey } from '@shared/workspace-ref'
import { APP_VERSION } from '../../app-metadata'
import {
  useCclinkStore,
  useFsStore,
  useOpenProjectsStore,
  useTabStore,
  useUpdateStore,
  useWorkspaceStore,
} from '../../stores'
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
 * 远程能力探测只记录协议 envelope，便于区分传输、关联和能力映射问题。
 */
export async function collectFrameworkDiagnosticReport(): Promise<string> {
  const [
    workspaceSection,
    credentialSection,
    scheduledTaskSection,
    browserSection,
    remoteSection,
    mainLogSection,
  ] = await Promise.all([
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
    collectSection('当前浏览器页面', collectActiveBrowserDiagnostics),
    collectSection('当前远程能力探测', collectActiveRemoteDiagnostics),
    collectSection('主进程近期框架日志', async () =>
      formatFrameworkLogSnapshot(await window.cclinkStudio.diagnostics.getMainLogSnapshot()),
    ),
  ])

  const runtimeSection = collectSyncSection('当前工作台运行状态', formatRuntimeState)
  const contextActionSection = collectSyncSection('上下文操作', () =>
    stripEmbeddedSectionHeading(
      formatContextActionDiagnosticsMarkdown(useContextActionDiagnosticsStore.getState().events),
      '上下文操作',
    ),
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
    browserSection,
    remoteSection,
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

async function collectActiveRemoteDiagnostics(): Promise<string> {
  const ref = useWorkspaceStore.getState().activeWorkspaceRef
  const openRemoteCount = useOpenProjectsStore.getState().openRemoteWorkspaceRefs.length
  const realtimeState = useCclinkStore.getState().realtime.state
  if (ref.kind !== 'remote') {
    return [
      '- 当前激活：本地工作区',
      `- 项目条中已打开远程工作区：${openRemoteCount}`,
      `- CCLink 实时连接：${realtimeState}`,
      ...(openRemoteCount > 0
        ? ['- 说明：实时连接服务于仍然打开的远程项目，不改变当前本地项目的类型']
        : []),
    ].join('\n')
  }

  const report = await window.cclinkStudio.remote.diagnose(ref)
  const probe = report.status.capabilityProbe
  return [
    `- 项目条中已打开远程工作区：${openRemoteCount}`,
    `- CCLink 实时连接：${realtimeState}`,
    `- 设备：${report.status.endpointName ?? ref.endpointId}`,
    `- 状态：${report.status.state}`,
    `- Agent 版本：${report.status.agentVersion ?? '未知'}`,
    `- 协议版本：${report.status.protocolVersion ?? '未知'}`,
    `- runtime：${report.status.runtime ?? '未知'}`,
    `- 探测状态：${probe?.state ?? '无响应'}`,
    `- 探测时间：${probe?.checkedAt ?? '未知'}`,
    `- stale：${probe?.stale === true}`,
    ...(report.status.remoteError
      ? [
          `- 错误：${report.status.remoteError.code} · ${report.status.remoteError.message}`,
          `- 错误层：${report.status.remoteError.layer} · retryable=${report.status.remoteError.retryable}`,
        ]
      : []),
    '- capability_probe_response：',
    '```json',
    JSON.stringify(probe?.response ?? null, null, 2),
    '```',
  ].join('\n')
}

async function collectActiveBrowserDiagnostics(): Promise<string> {
  const tabState = useTabStore.getState()
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId)
  if (activeTab?.type !== 'browser') return '- 当前没有活跃浏览器页面'

  return formatBrowserRuntimeDiagnostics(
    await window.cclinkStudio.browser.getRuntimeDiagnostics(activeTab.id),
  )
}

function formatBrowserRuntimeDiagnostics(summary: BrowserRuntimeDiagnosticSummary): string {
  const lines = [
    `- 请求 Tab：${summary.requestedTabId}`,
    `- 可视 Tab：${summary.visibleTabId ?? '无'}`,
    `- 当前 URL：${summary.visibleUrl ?? '无'}`,
    `- 当前标题：${summary.visibleTitle || '无'}`,
    `- 页面绑定：${summary.bindingStatus}`,
    `- 浏览器 Profile：${summary.profileId ? '已配置' : '默认'}`,
  ]

  if (summary.engineVersions) {
    lines.push(
      `- 引擎版本：Electron ${summary.engineVersions.electron} · Chromium ${summary.engineVersions.chromium} · Node ${summary.engineVersions.node}`,
    )
  }

  if (summary.lastClaim) {
    lines.push(
      `- 最近页面绑定：${summary.lastClaim.status} · ${formatBrowserTimestamp(summary.lastClaim.timestamp)}${summary.lastClaim.errorMessage ? ` · ${summary.lastClaim.errorMessage}` : ''}`,
    )
  } else {
    lines.push('- 最近页面绑定：无')
  }

  if (summary.httpAuth) {
    const auth = summary.httpAuth
    lines.push(
      `- HTTP 认证：${auth.outcome} · ${formatBrowserTimestamp(auth.timestamp)} · ${auth.origin} · realm=${auth.realm} · transport=${auth.transport} · attempt=${auth.attempt}${auth.reason ? ` · reason=${auth.reason}` : ''}`,
    )
  } else {
    lines.push('- HTTP 认证：无')
  }

  if (summary.layout) {
    lines.push(
      `- 浏览器布局：renderer=${JSON.stringify(summary.layout.rendererBounds)} native=${JSON.stringify(summary.layout.nativeBounds)} protectedTop=${summary.layout.protectedTop} nativeProtectedTop=${summary.layout.nativeProtectedTop} overlapsProtectedTop=${summary.layout.overlapsProtectedTop}`,
    )
  } else {
    lines.push('- 浏览器布局：不可用')
  }

  if (!summary.page) {
    lines.push('- 页面 Console：不可用', '- 页面 Network：不可用')
    return lines.join('\n')
  }

  if (summary.page.consoleErrors.length > 0) {
    lines.push('- 页面 Console：')
    lines.push(
      ...summary.page.consoleErrors
        .slice(-10)
        .map(
          (entry) =>
            `  - ${formatBrowserTimestamp(entry.timestamp)} · ${entry.type} · ${entry.text.replace(/\s+/g, ' ')}`,
        ),
    )
  } else {
    lines.push('- 页面 Console：无 error/warn')
  }

  if (summary.page.networkIssues.length > 0) {
    lines.push('- 页面 Network：')
    lines.push(
      ...summary.page.networkIssues.slice(-10).map((entry) => {
        const outcome = entry.failed
          ? `failed:${entry.errorText ?? 'unknown'}`
          : `status:${entry.status ?? 'unknown'}`
        return `  - ${formatBrowserTimestamp(entry.timestamp)} · ${entry.method} · ${outcome} · ${entry.url}`
      }),
    )
  } else {
    lines.push('- 页面 Network：无失败/4xx/5xx')
  }

  if (summary.page.suspectedChallenges.length > 0) {
    lines.push(`- 疑似页面挑战：${summary.page.suspectedChallenges.join(', ')}`)
  }

  return lines.join('\n')
}

function formatBrowserTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toISOString()
}

function stripEmbeddedSectionHeading(markdown: string, title: string): string {
  return markdown.replace(new RegExp(`^\\s*##\\s+${title}\\s*\\n?`), '')
}

function formatRuntimeState(): string {
  const fs = useFsStore.getState()
  const projects = useOpenProjectsStore.getState()
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
    `- 已打开项目：本地=${projects.openProjectPaths.length} 远程=${projects.openRemoteWorkspaceRefs.length}`,
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
