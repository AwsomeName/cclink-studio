/**
 * CCLink Studio 全局类型定义
 */

import type { RemoteWorkspaceTransport, WorkspaceRef } from '@shared/workspace-ref'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import type { TerminalCommandConfirmationRequest, TerminalTabRef } from '@shared/terminal'

export type { LocalIdentity } from '@shared/ipc/identity'

// ─── UI 类型 ───────────────────────────────────────

/** Activity Bar 面板类型 */
export type ActivityPanel =
  | 'projects'
  | 'browser'
  | 'files'
  | 'data-sources'
  | 'production'
  | 'terminal'
  | 'operations'
  | 'sessions'

/** Workbench Tab 类型 */
export type TabType =
  | 'browser'
  | 'editor'
  | 'settings'
  | 'preview'
  | 'android'
  | 'model'
  | 'conversation'
  | 'cclink'
  | 'remote-file'
  | 'hardware-gerber'
  | 'terminal'
  | 'terminal-record'
  | 'data-source-query'
  | 'data-source-result'

export type ConversationSurface = 'assistant-panel' | 'workbench-tab'

export type ConversationRuntimeLocation = 'local' | 'remote'

export type ConversationTransport = 'local' | RemoteWorkspaceTransport

export type ConversationBackend = 'deepink-agent' | 'codex' | 'claude-code' | 'custom'

export type AgentMountedResourceKind =
  | 'file'
  | 'tab'
  | 'browser'
  | 'android'
  | 'terminal'
  | 'artifact'
  | 'project'
  | 'data-source'
  | 'saved-query'
  | 'data-query'
  | 'data-record'

/** 会话已挂载资源：M3 先作为前端会话状态，M5 再进入发送协议。 */
export interface AgentMountedResource {
  id: string
  kind: AgentMountedResourceKind
  label: string
  detail?: string
  ref: {
    type: AgentMountedResourceKind
    path?: string
    tabId?: string
    workspaceKey?: string | null
    sourceId?: string
    collection?: string
    savedQueryId?: string
    queryId?: string
    recordId?: string
    sourceUrl?: string
    publishedAt?: string
    collectedAt?: string
    executedAt?: string
    total?: number
    returned?: number
    truncated?: boolean
  }
}

/** 会话已挂载 Skill：当前会话/当前消息使用的流程能力，长期配置仍归设置页。 */
export interface AgentMountedSkill {
  id: string
  name: string
  label: string
  description?: string
  source?: 'builtin' | 'user' | 'workspace'
}

/** 会话运行环境：同一类 conversation，可运行在本地或远端。 */
export type ConversationRuntimeRef = {
  location: ConversationRuntimeLocation
  transport: ConversationTransport
  backend?: ConversationBackend
  workspaceRef?: WorkspaceRef
}

/** 旧远程会话 Tab 引用；仅用于恢复迁移窗口内的历史快照。 */
export type LegacyConversationTabRef = {
  kind: 'remote'
  transport: RemoteWorkspaceTransport
  sessionId: string
}

/** Workbench 会话 Tab 引用 */
export type ConversationTabRef =
  | {
      surface: 'workbench-tab'
      runtime: ConversationRuntimeRef
      sessionId: string
    }
  | LegacyConversationTabRef

/** Workbench Tab */
export interface Tab {
  id: string
  type: TabType
  title: string
  icon: string
  /** 关联的文件路径（编辑器 Tab 使用） */
  filePath?: string
  /** 是否有未保存的修改 */
  dirty?: boolean
  /** 复制编辑器 Tab 时的种子内容（仅激活创建时消费一次） */
  initialContent?: string
  /** 新建/复制浏览器 Tab 时的初始 URL（仅激活创建时消费一次） */
  initialUrl?: string
  /** 浏览器持久化 Profile，用于隔离平台登录态。 */
  browserProfile?: string | null
  /** 从快照重建时的视图模式/缩放（仅激活创建时消费一次） */
  restore?: {
    viewMode: 'desktop' | 'mobile'
    zoomMode: 'fit' | 'manual'
    manualZoom: number
    history?: string[]
    historyIndex?: number
  }
  /** 通用会话 Tab 引用；旧 cclinkSessionId / LegacyConversationTabRef 迁移完成前并存 */
  conversation?: ConversationTabRef
  /** CCLink 远程会话 ID */
  cclinkSessionId?: string
  /** 设置页目标分组 */
  settingsSection?: string
  /** 远程只读文件 */
  remoteFile?: {
    serverId: string
    workspaceId: string
    path: string
  }
  /** Gerber 生产包层预览 */
  hardwareGerber?: {
    workspacePath: string
    packagePath: string
    entry?: string
  }
  /** Terminal 工作现场；M6 先定义模型，不开放真实 shell */
  terminal?: TerminalTabRef
  /** Terminal 只读历史记录 */
  terminalRecord?: TerminalSessionSnapshot
  /** 数据源查询现场 */
  dataSourceQuery?: {
    sourceId: string
    collection?: string
    savedQueryId?: string
  }
}

// ─── Playwright 类型 ───────────────────────────────

/** Playwright 连接状态 */
export interface PlaywrightStatus {
  connected: boolean
  pageUrl: string | null
}

// ─── Agent 消息类型 ────────────────────────────────

/** Agent 消息角色 */
export type AgentRole = 'user' | 'assistant' | 'system'

/** Agent 后端状态 */
export type AgentBackendState =
  | 'disconnected' // 未连接（初始状态）
  | 'connecting' // 正在启动 CLI
  | 'connected' // CLI 就绪
  | 'streaming' // 正在接收流式响应
  | 'error' // 出错

// ─── 内容块类型（支持流式渲染） ─────────────────────

/** 文本内容块 */
export interface TextContentBlock {
  type: 'text'
  text: string
}

/** 思考内容块 */
export interface ThinkingContentBlock {
  type: 'thinking'
  thinking: string
}

/** 工具调用内容块 */
export interface ToolUseContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  /** 内部字段：流式接收时暂存未完成的 JSON 字符串 */
  _rawInputJson?: string
}

/** 工具结果内容块 */
export interface ToolResultContentBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

/** 所有内容块联合类型 */
export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock

/** Agent 消息 — 支持流式和完整两种模式 */
export interface AgentMessage {
  id: string
  role: AgentRole
  /** 结构化内容块 */
  content: ContentBlock[]
  /** 纯文本（从 content 中 text 块提取，方便简单显示） */
  rawText: string
  timestamp: number
  /** 是否仍在流式接收中 */
  isStreaming?: boolean
}

export type {
  AgentScope,
  ClaudeAssistantEvent,
  ClaudeEvent,
  ClaudeResultEvent,
  ClaudeStreamEvent,
  ClaudeSystemInitEvent,
  ToolConfirmationRequest,
} from '@shared/ipc/agent'

export type { PermissionMode } from '@shared/ipc/settings'
export type { TerminalCommandConfirmationRequest }
