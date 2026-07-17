/**
 * IAgentBackend — 可插拔 AI 后端接口
 *
 * Claude Agent SDK 是其中一种实现。
 * M9 起开源底座只保留本机 Claude Code agent 完整工具模式。
 * HTTP Chat / 多模型直连后续作为独立后端再接入。
 */

/** 后端事件类型 */
export type AgentEventType = 'stream' | 'complete' | 'error' | 'system'

/** 后端事件回调 */
export type AgentEventHandler = (type: AgentEventType, data: unknown) => void

/** 后端状态 */
export interface AgentBackendStatus {
  connected: boolean
  sessionId: string | null
  /** 由 AgentRuntime 注入；后端本身无需生成。 */
  runId?: string | null
}

/** Host-provided labels used by backend prompts and tool context. */
export interface AgentHostContext {
  /** Product or host application name shown to the model. */
  hostName?: string
  /** MCP server name shown in the generated tool table. */
  mcpServerName?: string
  /** Label for the process that owns Android device control. */
  androidControllerName?: string
}

/** AI 后端接口 — 所有后端必须实现 */
export interface IAgentBackend {
  /** 启动后端（如需要初始化连接） */
  start?(): Promise<void>

  /**
   * 设置操作作用域（Agent 操作目标 + 工具收窄范围）
   *
   * 后端在每次 sendMessage 时读取最新值（每次 spawn CLI 参数，会话中途改也安全）。
   */
  setScope?(scope: import('../runtime/scope.js').AgentScope): void

  /** 发送用户消息 */
  sendMessage(message: string, options?: AgentSendOptions): Promise<void>

  /** 中止当前响应 */
  abort(): Promise<void>

  /** 获取后端状态 */
  getStatus(): AgentBackendStatus

  /** 重置会话（开始新对话） */
  resetSession(): void

  /** 获取会话 ID */
  getSessionId(): string | null

  /** 恢复已有会话 ID（用于渲染进程恢复历史会话后继续 resume） */
  setSessionId?(sessionId: string | null): void

  /** 注册事件回调 */
  onEvent(handler: AgentEventHandler): void

  /** 销毁资源 */
  destroy(): Promise<void>
}

/** 单轮发送策略：由宿主根据 @ 资源 / scope 判定。 */
export interface AgentSendOptions {
  /** 当前消息所属会话，用于把 MCP 工具确认等运行态回传到正确会话。 */
  conversationId?: string
  /** 当前发送对应的运行实例，由 renderer 创建并贯穿事件链。 */
  runId?: string
  /** 当前会话绑定的本地工作目录；优先级高于全局当前工作区。 */
  workspacePath?: string
  /**
   * true 时强制走宿主可视浏览器：禁用 Claude Code 内置工具，避免 WebSearch/WebFetch 绕过 UI。
   */
  forceVisibleBrowser?: boolean
  /** 宿主采样的结构化资源事实包，供后端 prompt 和诊断使用。 */
  resourceContext?: import('../../../shared/agent-resource-context').AgentResourceContextSnapshot
}

/** 后端配置 */
export interface BackendConfig {
  type: 'local-claude-code'
  /** Claude Code 配置 */
  claudeCode?: {
    /** Claude Code executable 绝对路径；为空时按 PATH 解析。 */
    claudeCodePath?: string
    maxBudgetUsd?: number
    /** 注入到子进程的环境变量。第一版默认交给 Claude Code 自身管理模型登录。 */
    env?: Record<string, string>
    /** Anthropic-compatible API base URL for the SDK subprocess. */
    apiBaseUrl?: string
    /** Anthropic-compatible API key for the SDK subprocess. */
    apiKey?: string
    /** Model name passed to the Claude Agent SDK query. */
    modelName?: string
    /** 获取当前工作区路径（用于把 Agent 的 cwd 绑定到工作区；空串=未选） */
    getWorkspacePath?: () => string
    /** 宿主产品/工具上下文标签；core 默认保持泛化，具体产品在宿主侧注入。 */
    hostContext?: AgentHostContext
  }
}
