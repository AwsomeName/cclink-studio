import type { CclinkRemoteMessage } from '@shared/cclink'
import { sanitizeDiagnosticText } from '@shared/diagnostics'
import type {
  RemoteAgentSessionDiagnosticEvent,
  RemoteDiagnosticReport,
} from '@shared/remote-protocol'
import { redactDiagnosticValue, redactText } from './agent-diagnostic-report'

const MAX_TIMELINE_ITEMS = 100

export function buildRemoteAgentDiagnosticMarkdown(input: {
  appVersion: string
  platform: string
  report: RemoteDiagnosticReport
  collectionError?: string | null
}): string {
  const { report } = input
  const session = report.agentSession?.session
  const events = report.agentSession?.events ?? []
  const messages = report.agentSession?.messages ?? []
  const endAssessment = assessEnding(session?.status, events)
  return [
    '# CCLink Studio 远程 Agent 诊断日志',
    '',
    '## 元信息',
    `- 生成时间：${formatDateTime(report.generatedAt)}`,
    `- Studio 版本：${safe(input.appVersion)}`,
    `- 平台：${safe(input.platform)}`,
    `- 远程设备：${safe(report.status.endpointName ?? report.ref.endpointName ?? report.ref.endpointId)}`,
    `- Agent 版本：${safe(report.status.agentVersion ?? '未知')}`,
    `- 协议版本：${safe(report.status.protocolVersion ?? '未知')}`,
    `- Runtime：${safe(report.status.runtime ?? '未知')}`,
    `- 工作区：${safe(report.ref.path)}`,
    `- 会话 ID：${safe(session?.id ?? '未选择')}`,
    `- 会话标题：${safe(session?.name ?? '未选择')}`,
    '',
    '## 当前状态',
    `- 设备连接：${report.status.state}`,
    `- 协议兼容：${report.status.compatibility}`,
    `- 会话状态：${session?.status ?? 'unknown'}`,
    `- 结束判断：${endAssessment}`,
    ...report.checks.map(
      (check) => `- ${safe(check.label)}：${check.status} · ${safe(check.message)}`,
    ),
    '',
    '## 协议事件时间线',
    ...(events.length > 0
      ? events.slice(-MAX_TIMELINE_ITEMS).map(formatProtocolEvent)
      : ['- 当前进程未捕获该会话的协议事件']),
    '',
    '## 会话消息与工具时间线',
    ...(messages.length > 0
      ? messages.slice(-MAX_TIMELINE_ITEMS).map(formatMessage)
      : ['- 当前会话没有可复制消息']),
    '',
    '## 最近远程错误',
    ...(report.recentErrors.length > 0
      ? report.recentErrors.map(
          (event) =>
            `- [${formatTime(event.timestamp)}] ${safe(event.operation)} · ${safe(event.error.code)} · ${safe(event.error.message)}`,
        )
      : ['- 无']),
    ...(input.collectionError ? ['', '## 采集失败', `- ${safe(input.collectionError)}`] : []),
    '',
    '## 采集边界',
    `- 会话消息最多复制最近 ${report.agentSession?.messageLimit ?? 0} 条。`,
    `- 协议事件最多复制当前 Studio 进程最近 ${report.agentSession?.eventLimit ?? 0} 条；App 重启前的事件不可恢复。`,
    '- 当前报告不读取远程服务器上的 ChatTrace 原始日志。',
    '- password/token/cookie/authorization/API key/session key/手机号/邮箱等内容会脱敏或截断。',
  ].join('\n')
}

function assessEnding(
  sessionStatus: 'active' | 'idle' | 'archived' | undefined,
  events: RemoteAgentSessionDiagnosticEvent[],
): string {
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === 'stream_end' ||
        (event.type === 'agent_status' &&
          ['idle', 'completed', 'failed', 'error'].includes(event.status ?? '')),
    )
  if (terminal) {
    const details = [
      terminal.type,
      terminal.status && `status=${terminal.status}`,
      terminal.exitCode !== undefined && `exit=${terminal.exitCode}`,
      terminal.finalState && `final_state=${terminal.finalState}`,
      terminal.code && `code=${terminal.code}`,
    ].filter(Boolean)
    return `已收到结束事件（${details.join(' · ')}）`
  }
  if (sessionStatus === 'active') return '仍在运行，尚未收到结束事件'
  if (sessionStatus === 'idle') return 'Studio 显示已结束，但当前进程没有捕获结束事件'
  return '没有足够信息判断'
}

function formatProtocolEvent(event: RemoteAgentSessionDiagnosticEvent): string {
  const fields = [
    `${event.direction} ${event.type}`,
    event.count && event.count > 1 ? `count=${event.count}` : null,
    event.requestId ? `request=${safe(event.requestId)}` : null,
    event.traceId ? `trace=${safe(event.traceId)}` : null,
    event.messageId ? `msg=${safe(event.messageId)}` : null,
    event.status ? `status=${safe(event.status)}` : null,
    event.tool ? `tool=${safe(event.tool)}` : null,
    event.toolState ? `tool_state=${safe(event.toolState)}` : null,
    event.exitCode !== undefined ? `exit=${event.exitCode}` : null,
    event.finalState ? `final_state=${safe(event.finalState)}` : null,
    event.code ? `code=${safe(event.code)}` : null,
    event.error ? `error=${safe(event.error)}` : null,
    event.payloadTruncated ? 'payload_truncated=true' : null,
  ].filter(Boolean)
  return `- [${formatTime(event.timestamp)}] ${fields.join(' · ')}`
}

function formatMessage(message: CclinkRemoteMessage): string {
  const prefix = `- [${formatTime(normalizeTimestamp(message.timestamp))}]`
  switch (message.type) {
    case 'user':
      return `${prefix} user: ${safe(message.content)}`
    case 'agentText':
      return `${prefix} assistant: ${safe(message.content)}`
    case 'system':
      return `${prefix} system: ${safe(message.content)}`
    case 'agentTool': {
      const details = [
        `tool=${safe(message.tool.name)}`,
        `state=${message.tool.state}`,
        message.tool.input ? `input=${safeJson(message.tool.input)}` : null,
        message.tool.output ? `output=${safe(message.tool.output)}` : null,
        message.tool.error ? `error=${safe(message.tool.error)}` : null,
      ].filter(Boolean)
      return `${prefix} ${details.join(' · ')}`
    }
    case 'userQuestion':
      return `${prefix} question: ${message.questions.map((item) => safe(item.question)).join('；')} · answered=${message.answered === true}`
  }
}

function safeJson(value: unknown): string {
  try {
    return safe(JSON.stringify(redactDiagnosticValue('value', value)))
  } catch {
    return '[无法序列化]'
  }
}

function safe(value: string): string {
  return redactText(sanitizeDiagnosticText(value, 500))
}

function normalizeTimestamp(value: number): number {
  return value < 10_000_000_000 ? value * 1_000 : value
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}
