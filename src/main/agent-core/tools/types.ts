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
}

/** 工具模块接口 */
export interface ToolModule {
  /** 模块名，如 'browser'、'file'、'editor' */
  name: string
  /** 该模块提供的所有工具定义 */
  tools: ToolDefinition[]
  /** 执行工具调用 */
  execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown>
}

/** 权限模式（Phase 1 硬编码 'auto'，Phase 2 实现完整逻辑） */
export type PermissionMode = 'auto' | 'categorized' | 'strict'
