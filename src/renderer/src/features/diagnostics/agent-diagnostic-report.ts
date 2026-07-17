import type {
  BrowserActionLog,
  BrowserDownloadRecord,
  BrowserPageDiagnosticSummary,
  BrowserRuntimeDiagnosticSummary,
  BrowserTaskRun,
  BrowserViewState,
} from '@shared/ipc/browser'
import type {
  AgentBackendState,
  AgentMessage,
  AgentScope,
  ContentBlock,
  PermissionMode,
} from '../../types'
import type { AgentStatus } from '@shared/agent-protocol'
import type { AgentConversationState } from '../../stores/agent-store'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'

const MAX_TIMELINE_ITEMS = 100
const MAX_FIELD_LENGTH = 500
const SENSITIVE_KEY_RE =
  /(password|passwd|pwd|token|secret|cookie|authorization|api[-_]?key|session|验证码|校验码|短信|code)/i
const SENSITIVE_ASSIGNMENT_RE =
  /((?:password|passwd|pwd|token|secret|cookie|authorization|api[-_]?key|session|验证码|校验码|短信验证码|code|密码)\s*[:：=]\s*)(?!\[redacted\])([^\s,;，。]+)/gi
const PHONE_RE = /(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g
const EMAIL_RE = /\b([A-Z0-9._%+-]{2})[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi
const QUERY_SECRET_RE =
  /([?&](?:token|access_token|auth|authorization|session|code|key|secret)=)[^&#\s]+/gi

export interface BrowserDiagnosticSnapshot {
  tabId: string | null
  url: string | null
  title: string | null
  profile: string | null
  viewState: BrowserViewState | null
}

export interface AgentDiagnosticReportInput {
  generatedAt?: number
  appVersion?: string
  platform?: string
  workspaceRef?: WorkspaceRef | null
  conversation?: AgentConversationState | null
  agentRuntime?: AgentStatus | null
  messages: AgentMessage[]
  backendState: AgentBackendState
  permissionMode: PermissionMode
  scope: AgentScope
  browser: BrowserDiagnosticSnapshot
  browserRuntime?: BrowserRuntimeDiagnosticSummary | null
  pageDiagnostics?: BrowserPageDiagnosticSummary | null
  browserTask: BrowserTaskRun | null
  browserActionLogs: BrowserActionLog[]
  browserDownloads: BrowserDownloadRecord[]
  pendingConfirmationCount: number
}

interface TimelineEvent {
  timestamp: number
  kind: string
  summary: string
}

export function buildAgentDiagnosticMarkdown(input: AgentDiagnosticReportInput): string {
  const generatedAt = input.generatedAt ?? Date.now()
  const conversation = input.conversation
  const workspaceName = input.workspaceRef ? workspaceRefLabel(input.workspaceRef) : '未绑定'
  const workspaceSource = input.workspaceRef ? workspaceRefSourceLabel(input.workspaceRef) : '无'
  const workspaceKey = input.workspaceRef ? workspaceRefKey(input.workspaceRef) : null
  const userGoal = latestUserMessage(input.messages)
  const timeline = buildTimeline(input).slice(-MAX_TIMELINE_ITEMS)
  const runtime = input.browserRuntime

  return [
    '# CCLink Studio 诊断日志',
    '',
    '## 元信息',
    `- 生成时间：${formatDateTime(generatedAt)}`,
    `- CCLink Studio 版本：${redactText(input.appVersion ?? 'unknown')}`,
    `- 平台：${redactText(input.platform ?? 'unknown')}`,
    `- 工作区：${redactText(workspaceSource)} · ${redactText(workspaceName)}`,
    `- 工作区 Key：${redactText(workspaceKey ?? '未绑定')}`,
    `- 会话 ID：${redactText(conversation?.id ?? '未找到')}`,
    `- 会话标题：${redactText(conversation?.title ?? '未找到')}`,
    '',
    '## 用户目标',
    userGoal ? redactText(userGoal) : '未找到最近用户消息',
    '',
    '## 当前浏览器',
    `- Scope：${formatScope(input.scope)}`,
    `- tabId：${redactText(input.browser.tabId ?? '未挂载浏览器')}`,
    `- URL：${redactUrl(input.browser.url ?? '未知')}`,
    `- Title：${redactText(input.browser.title ?? '未知')}`,
    `- Profile：${redactText(input.browser.profile ?? 'default')}`,
    `- View Mode：${input.browser.viewState?.viewMode ?? 'unknown'}`,
    `- Zoom：${input.browser.viewState ? `${input.browser.viewState.zoomMode} / ${input.browser.viewState.zoomFactor}` : 'unknown'}`,
    `- 浏览器内核：Electron ${redactText(runtime?.engineVersions?.electron ?? 'unknown')} / Chromium ${redactText(runtime?.engineVersions?.chromium ?? 'unknown')}`,
    '',
    '## 浏览器绑定',
    `- 绑定状态：${runtime?.bindingStatus ?? 'unknown'}`,
    `- 请求 tabId：${redactText(runtime?.requestedTabId ?? input.browser.tabId ?? '未知')}`,
    `- 可视 tabId：${redactText(runtime?.visibleTabId ?? '无')}`,
    `- 可视 URL：${redactUrl(runtime?.visibleUrl ?? '未知')}`,
    `- 可视 Title：${redactText(runtime?.visibleTitle ?? '未知')}`,
    `- 自动化 tabId：${redactText(runtime?.playwrightTabId ?? '无')}`,
    `- 自动化 URL：${redactUrl(runtime?.playwrightUrl ?? '未知')}`,
    `- 自动化 Title：${redactText(runtime?.playwrightTitle ?? '未知')}`,
    ...formatBindingWarning(runtime),
    `- 最近 Claim：${formatLastClaim(runtime)}`,
    '- 最近 URL：',
    ...(runtime?.recentUrls.length
      ? runtime.recentUrls.map((url) => `  - ${redactUrl(url)}`)
      : ['  - 无']),
    '',
    '## 登录态',
    ...formatSessionDiagnostics(runtime, input.pageDiagnostics),
    '',
    '## Agent 状态',
    `- 后端状态：${input.backendState}`,
    `- 会话运行标记：${conversation?.runStatus ?? 'unknown'}`,
    `- UI loading：${conversation?.loading ?? false}`,
    `- UI runId：${redactText(conversation?.activeRunId ?? '无')}`,
    `- 主进程 busy：${input.agentRuntime?.busy ?? input.agentRuntime?.connected ?? 'unknown'}`,
    `- 主进程 ready：${input.agentRuntime?.ready ?? 'unknown'}`,
    `- 主进程 runId：${redactText(input.agentRuntime?.runId ?? '无')}`,
    `- 最近运行事件：${conversation?.lastRunEventAt ? formatDateTime(conversation.lastRunEventAt) : '无'}`,
    `- 最近终止原因：${conversation?.lastRunTerminalReason ?? '无'}`,
    `- 后端 Session：${input.agentRuntime?.sessionId ? '已存在' : '无'}`,
    `- 流式消息：${conversation?.streamingMessageId ? '进行中' : '无'}`,
    `- 权限模式：${input.permissionMode}`,
    `- 待确认操作：${input.pendingConfirmationCount}`,
    `- 任务状态：${input.browserTask?.status ?? '无浏览器任务'}`,
    `- 任务归因：${formatBrowserTaskAttribution(input)}`,
    `- taskRunId：${redactText(input.browserTask?.id ?? '无')}`,
    `- failureReason：${input.browserTask?.failureReason ?? '-'}`,
    `- errorMessage：${redactText(input.browserTask?.errorMessage ?? '-')}`,
    '',
    '## 时间线',
    ...(timeline.length > 0 ? timeline.map(formatTimelineEvent) : ['- 无事件']),
    '',
    '## 最近浏览器错误',
    ...formatPageDiagnostics(input.pageDiagnostics),
    '',
    '## 下载/上传',
    ...formatDownloads(input.browserDownloads),
    '',
    '## 脱敏说明',
    'password/token/cookie/authorization/api key/session/验证码/手机号/邮箱等字段已脱敏或截断。',
  ].join('\n')
}

export function redactDiagnosticValue(key: string, value: unknown): unknown {
  if (value == null) return value
  if (SENSITIVE_KEY_RE.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(key, item))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactDiagnosticValue(childKey, childValue),
      ]),
    )
  }
  return value
}

export function redactText(value: string): string {
  return truncate(value)
    .replace(SENSITIVE_ASSIGNMENT_RE, (_match, prefix: string, secret: string) => {
      return `${prefix}[redacted:${secret.length} chars]`
    })
    .replace(QUERY_SECRET_RE, '$1[redacted]')
    .replace(PHONE_RE, '$1****$3')
    .replace(EMAIL_RE, (_match, prefix: string, domain: string) => `${prefix}***${domain}`)
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY_RE.test(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }
    return redactText(url.toString())
  } catch {
    return redactText(value)
  }
}

function buildTimeline(input: AgentDiagnosticReportInput): TimelineEvent[] {
  const messageEvents = input.messages.flatMap((message) => messageToEvents(message))
  const actionEvents = input.browserActionLogs.flatMap((log) => actionLogToEvents(log))
  const downloadEvents = input.browserDownloads.map((download) => ({
    timestamp: download.completedAt ?? download.createdAt,
    kind: 'download',
    summary: `${download.status} ${download.suggestedFilename} (${download.trigger}/${download.retention})`,
  }))

  return [...messageEvents, ...actionEvents, ...downloadEvents].sort(
    (a, b) => a.timestamp - b.timestamp,
  )
}

function messageToEvents(message: AgentMessage): TimelineEvent[] {
  if (message.id === 'welcome') return []
  if (message.role === 'user') {
    return [{ timestamp: message.timestamp, kind: 'user_message', summary: message.rawText }]
  }
  if (message.role === 'system') {
    return [{ timestamp: message.timestamp, kind: 'system_message', summary: message.rawText }]
  }

  return message.content.map((block) => ({
    timestamp: message.timestamp,
    kind: blockKind(block),
    summary: blockSummary(block),
  }))
}

function actionLogToEvents(log: BrowserActionLog): TimelineEvent[] {
  const duration =
    typeof log.endedAt === 'number' ? `${Math.max(0, log.endedAt - log.startedAt)}ms` : 'running'
  const base = `${log.action} ${duration} ${redactText(log.paramsSummary)}`
  const events: TimelineEvent[] = [
    {
      timestamp: log.startedAt,
      kind: 'browser_action_start',
      summary: base,
    },
  ]
  if (log.endedAt) {
    events.push({
      timestamp: log.endedAt,
      kind: log.status === 'failed' ? 'browser_action_fail' : 'browser_action_done',
      summary:
        log.status === 'failed'
          ? `${log.action} failed reason=${log.failureReason ?? 'unknown'} error=${redactText(log.errorMessage ?? '-')}`
          : `${log.action} ${log.status} ${duration}`,
    })
  }
  return events
}

function blockKind(block: ContentBlock): string {
  switch (block.type) {
    case 'tool_use':
      return 'tool_start'
    case 'tool_result':
      return block.is_error ? 'tool_fail' : 'tool_result'
    case 'thinking':
      return 'assistant_thinking'
    default:
      return 'assistant_text'
  }
}

function blockSummary(block: ContentBlock): string {
  switch (block.type) {
    case 'tool_use':
      return `${block.name} ${safeJson(redactDiagnosticValue(block.name, block.input))}`
    case 'tool_result':
      return `${block.tool_use_id} ${block.is_error ? 'error' : 'ok'} ${block.content}`
    case 'thinking':
      return block.thinking
    case 'text':
      return block.text
  }
}

function formatTimelineEvent(event: TimelineEvent): string {
  return `[${formatTime(event.timestamp)}] ${event.kind}: ${redactText(event.summary)}`
}

function formatDownloads(downloads: BrowserDownloadRecord[]): string[] {
  if (downloads.length === 0) return ['- 无']
  return downloads.map((download) => {
    const path = download.savedPath ?? download.tempPath ?? ''
    return [
      `- ${redactText(download.suggestedFilename)}`,
      `状态=${download.status}`,
      `触发=${download.trigger}`,
      `保留=${download.retention}`,
      `路径=${path ? redactText(path) : '无'}`,
    ].join(' · ')
  })
}

function formatPageDiagnostics(summary?: BrowserPageDiagnosticSummary | null): string[] {
  if (!summary) return ['- 页面诊断：不可用']
  const lines = [
    `- 当前 URL：${redactUrl(summary.url)}`,
    `- 当前标题：${redactText(summary.title || '未知')}`,
    `- 疑似挑战：${summary.suspectedChallenges.length > 0 ? summary.suspectedChallenges.join(', ') : '无'}`,
  ]
  if (summary.consoleErrors.length > 0) {
    lines.push('- Console：')
    lines.push(
      ...summary.consoleErrors.slice(-5).map((entry) => {
        return `  - [${formatTime(entry.timestamp)}] ${entry.type}: ${redactText(entry.text)}`
      }),
    )
  } else {
    lines.push('- Console：无 error/warn')
  }
  if (summary.networkIssues.length > 0) {
    lines.push('- Network：')
    lines.push(
      ...summary.networkIssues.slice(-8).map((entry) => {
        const status = entry.failed
          ? `failed:${entry.errorText ?? 'unknown'}`
          : `status:${entry.status ?? 'unknown'}`
        return `  - [${formatTime(entry.timestamp)}] ${entry.method} ${status} ${redactUrl(entry.url)}`
      }),
    )
  } else {
    lines.push('- Network：无失败/4xx/5xx')
  }
  if (summary.pageTextSample) {
    lines.push(`- 页面文本片段：${redactText(summary.pageTextSample)}`)
  }
  return lines
}

function formatBindingWarning(runtime?: BrowserRuntimeDiagnosticSummary | null): string[] {
  if (!runtime || runtime.bindingStatus === 'matched') return []
  switch (runtime.bindingStatus) {
    case 'url_mismatch':
      return ['- 警告：可视页面与自动化页面 URL 不一致，工具结果不可直接当作屏幕状态。']
    case 'tab_mismatch':
      return ['- 警告：可视 Tab、请求 Tab 与自动化 Tab 未对齐。']
    case 'unclaimed':
      return ['- 警告：当前可视页面尚未绑定 Playwright Page，自动化不可用。']
    case 'view_missing':
      return ['- 警告：主进程中找不到请求的可视浏览器 View。']
  }
}

function formatLastClaim(runtime?: BrowserRuntimeDiagnosticSummary | null): string {
  const claim = runtime?.lastClaim
  if (!claim) return '无记录'
  const base = `${claim.status} · ${formatDateTime(claim.timestamp)} · expected=${redactUrl(claim.expectedUrl)}`
  return claim.errorMessage ? `${base} · error=${redactText(claim.errorMessage)}` : base
}

function formatSessionDiagnostics(
  runtime?: BrowserRuntimeDiagnosticSummary | null,
  pageDiagnostics?: BrowserPageDiagnosticSummary | null,
): string[] {
  const session = runtime?.session
  if (!session) return ['- Session：不可用']
  const likelyAuth = session.likelyAuthCookies
  const pageRequiresAuth =
    runtime?.page?.suspectedChallenges.includes('auth_required') ||
    pageDiagnostics?.suspectedChallenges.includes('auth_required') ||
    false
  const cookieNames =
    session.cookieNames.length > 0 ? session.cookieNames.map(redactText).join(', ') : '无'
  const lines = [
    `- 实际 Profile：${redactText(runtime?.profileId ?? 'default')}`,
    `- Partition：${redactText(session.partition)}`,
    `- 持久 Session：${session.persistent ? '是' : '否'}`,
    `- Cookie 已 flush：${session.cookieStoreFlushed ? '是' : '否'}`,
    `- 当前站点 Cookie：${session.cookieCount}（持久 ${session.persistentCookieCount}，已过期 ${session.expiredCookieCount}）`,
    `- 疑似认证 Cookie：${likelyAuth.length}`,
    `- Cookie 名称：${cookieNames}`,
    '- 最近 Cookie 变更：',
    ...(session.recentCookieChanges.length > 0
      ? session.recentCookieChanges.map((change) => {
          const action = change.removed ? 'removed' : 'added/updated'
          const expires =
            typeof change.expiresAt === 'number' ? formatDateTime(change.expiresAt) : '会话结束'
          return `  - [${formatTime(change.timestamp)}] ${redactText(change.name)} · ${action} · cause=${change.cause} · auth=${change.likelyAuth ? '是' : '否'} · session=${change.session ? '是' : '否'} · expires=${expires}`
        })
      : ['  - 无']),
  ]
  if (likelyAuth.length > 0) {
    lines.push(
      ...likelyAuth.map((cookie) => {
        const expires =
          typeof cookie.expiresAt === 'number' ? formatDateTime(cookie.expiresAt) : '会话结束'
        return `  - ${redactText(cookie.name)} · domain=${redactText(cookie.domain)} · session=${cookie.session ? '是' : '否'} · expires=${expires}`
      }),
    )
  }
  if (pageRequiresAuth && likelyAuth.length === 0) {
    const removedAuth = [...session.recentCookieChanges]
      .reverse()
      .find((change) => change.likelyAuth && change.removed)
    if (removedAuth) {
      lines.push(
        `- 登录态判断：页面要求登录，且认证 Cookie ${redactText(removedAuth.name)} 曾被删除（cause=${removedAuth.cause}）；认证态已被清除或撤销。`,
      )
    } else {
      lines.push(
        '- 登录态判断：未发现常见认证 Cookie，变更时间线也没有认证 Cookie 删除记录；认证态可能从未建立。',
      )
    }
  } else if (pageRequiresAuth) {
    lines.push(
      '- 登录态判断：页面仍要求登录；疑似认证 Cookie 的存在不能证明认证有效，可能已失效或不完整。',
    )
  } else if (likelyAuth.length === 0) {
    lines.push('- 登录态判断：未发现常见认证 Cookie；当前页面也未明确判定需要登录。')
  }
  if (session.errorMessage) {
    lines.push(`- Session 诊断错误：${redactText(session.errorMessage)}`)
  }
  return lines
}

function latestUserMessage(messages: AgentMessage[]): string | null {
  const user = [...messages].reverse().find((message) => message.role === 'user')
  return user?.rawText ?? null
}

function formatScope(scope: AgentScope): string {
  switch (scope.kind) {
    case 'browser':
      return `browser:${scope.instanceId}`
    case 'editor':
      return 'editor'
    case 'android':
      return 'android'
    case 'all':
      return 'all'
  }
}

function formatBrowserTaskAttribution(input: AgentDiagnosticReportInput): string {
  if (input.browserTask) return '已绑定 BrowserTaskRun'
  if (!input.browser.tabId) return '未挂载浏览器 tab'
  if (input.scope.kind === 'all') {
    return '未绑定任务；旧版本可能因 scope=all 未自动归因到活跃浏览器'
  }
  if (input.scope.kind === 'browser') return 'scope 已指向浏览器，但未找到任务记录'
  return `当前 scope=${input.scope.kind}，未进入浏览器任务轨道`
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_FIELD_LENGTH) return value
  return `${value.slice(0, MAX_FIELD_LENGTH - 3)}...`
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}
