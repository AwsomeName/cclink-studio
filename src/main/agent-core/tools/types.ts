/**
 * MCP 模块类型定义
 *
 * 定义 ToolModule、ToolDefinition 等核心接口，
 * 供 McpToolHost 和各工具模块使用。
 */

/** 工具注解（Phase 2 权限分类用） */
export interface ToolAnnotations {
  /** true = 只读操作，不改变页面/系统状态 */
  readOnlyHint: boolean
  /** true = 不可逆操作（如执行 JS、删除文件） */
  destructiveHint: boolean
}

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名，如 browser_navigate */
  name: string
  /** 工具描述，AI 会读取此文本决定何时使用 */
  description: string
  /** 输入参数的 JSON Schema */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** 工具注解（权限分类） */
  annotations: ToolAnnotations
}

/** 单轮 MCP 调用的宿主归属；工具不得用当前可见项目覆盖这里的来源。 */
export interface ToolExecutionContext {
  conversationId?: string
  workspaceKey?: string | null
  /** 宿主在启动 Agent run 时固定的工作空间；模型不能通过工具参数覆盖。 */
  trustedWorkspace?:
    | {
        kind: 'local'
        rootPath: string
        workspaceKey: string
      }
    | {
        kind: 'remote'
        workspaceKey: string
      }
    | {
        kind: 'global'
        workspaceKey: null
      }
  /** 当前 Agent Run，用于把首次工具调用关联到可诊断的任务。 */
  agentRunId?: string | null
  /** 当前用户目标，只在主进程的短期 MCP session 内使用。 */
  agentGoal?: string
  scheduledTaskPolicy?: {
    origin: 'scheduled-task'
    taskId: string
    taskRevision: number
    runId: string
    workspaceRoot: string
    readRoots: string[]
    allowedTools: string[]
  }
  /**
   * 文章发布运行由主进程在启动时签发的不可伪造身份。
   * 模型参数只表达“要报告什么”，不得用 affairId/attemptId 冒充当前执行代次。
   */
  articlePublishingPolicy?: {
    origin: 'article-publishing'
    workspaceId: string
    affairId: string
    attemptId: string
    executionGeneration: number
    launchOperationId: string
  }
  /** 工具宿主已为本次调用取得显式用户确认。 */
  confirmationGranted?: boolean
  /** run 取消时触发；执行时间较长的模块应协作停止尚未提交的工作。 */
  abortSignal?: AbortSignal
}

export interface ToolExecutionPolicy {
  requireConfirmation: boolean
  riskLevel?: 'read' | 'write' | 'destructive'
  reason?: string
  allowAlways?: boolean
  /** 专用主进程策略已校验精确、短期、有界授权；统一 broker 不再重复弹确认。 */
  authorizationSatisfied?: boolean
}

/** 工具模块接口 */
export interface ToolModule {
  /** 模块名，如 'browser'、'file'、'editor' */
  name: string
  /** 该模块提供的所有工具定义 */
  tools: ToolDefinition[]
  /** 根据目标页面和参数追加运行时确认策略。 */
  getExecutionPolicy?(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionPolicy | null> | ToolExecutionPolicy | null
  /** 执行工具调用 */
  execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown>
}

/** 权限模式（Phase 1 硬编码 'auto'，Phase 2 实现完整逻辑） */
export type PermissionMode = 'auto' | 'categorized' | 'strict'
