/**
 * McpToolHost — 统一 MCP 工具注册中心
 *
 * 接收任意 ToolModule 注册，通过 JSON-RPC over HTTP 对外暴露 MCP 工具。
 *
 * 架构说明：
 * - Claude Code backend may spawn a fresh CLI process per sendMessage
 *   (therefore a fresh MCP client).
 * - MCP SDK 1.29+ 的 StreamableHTTPServerTransport 设计为「单客户端单会话」，
 *   无论是 stateless 还是 stateful 模式都无法支持多进程复用。
 * - 因此直接实现 JSON-RPC over HTTP，每个请求独立处理，无 session 管理。
 *
 * 支持的 MCP 方法：
 * - initialize — 返回 server 信息（每次请求单独处理，不维护 session）
 * - tools/list — 返回所有已注册工具
 * - tools/call — 调用指定工具
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolModule, ToolDefinition, ToolAnnotations, ToolExecutionContext } from './types.js'
import {
  AgentToolAuthorizationBroker,
  type ToolPermissionController,
  type ToolAuthorizationResult,
} from './agent-tool-authorization-broker.js'

export type {
  ToolConfirmationInput,
  ToolPermissionController,
} from './agent-tool-authorization-broker.js'

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  jsonrpc: string
  id: number | string | null
  method: string
  params?: unknown
}

type McpRequestContext = ToolExecutionContext

/** Agent 工具输入（含 JSON envelope）的硬上限；用于限制 loopback 服务的主进程内存压力。 */
export const MAX_MCP_REQUEST_BYTES = 8 * 1024 * 1024
export const MAX_MCP_BATCH_REQUESTS = 100

class McpHttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly rpcCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'McpHttpRequestError'
  }
}

/** JSON-RPC 成功的响应 */
function jsonRpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

/** JSON-RPC 错误的响应 */
function jsonRpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export class McpToolHost {
  private httpServer: Server | null = null
  private port: number = 0
  /** 模块名 → 模块 */
  private readonly modules: Map<string, ToolModule> = new Map()
  /** 工具名 → 所属模块名（用于路由） */
  private readonly toolToModule: Map<string, string> = new Map()
  /** 用户显式禁用的模块；禁用后既不广播工具，也拒绝残留客户端调用。 */
  private readonly disabledModules: Set<string> = new Set()
  /** Agent 工具授权的唯一策略 owner。 */
  private readonly authorizationBroker: AgentToolAuthorizationBroker
  /** 单轮 Agent 进程 → CCLink Studio 会话的短期映射 */
  private readonly toolSessions = new Map<string, ToolExecutionContext>()
  private readonly toolSessionAbortControllers = new Map<string, AbortController>()
  private readonly cancelledToolSessions = new WeakSet<ToolExecutionContext>()
  /** 已进入本机工具处理链的调用；取消终态必须等这些调用全部结束。 */
  private readonly activeToolCalls = new WeakMap<ToolExecutionContext, Set<Promise<unknown>>>()

  constructor(permissionManager: ToolPermissionController) {
    this.authorizationBroker = new AgentToolAuthorizationBroker(permissionManager)
  }

  authorizeSdkTool(input: {
    toolName: string
    params: Record<string, unknown>
    context: ToolExecutionContext
    reason?: string
    authorizationId?: string
  }): Promise<ToolAuthorizationResult> {
    return this.authorizationBroker.authorizeSdkTool(input)
  }

  authorizeClassifiedTool(input: {
    toolName: string
    params: Record<string, unknown>
    riskLevel: 'read' | 'write' | 'destructive'
    context: ToolExecutionContext
    reason?: string
  }): Promise<ToolAuthorizationResult> {
    return this.authorizationBroker.authorizeClassifiedTool(input)
  }

  /**
   * 注册工具模块
   *
   * 必须在 start() 之前调用。
   */
  registerModule(module: ToolModule): void {
    for (const tool of module.tools) {
      if (this.toolToModule.has(tool.name)) {
        const existing = this.toolToModule.get(tool.name)
        console.warn(
          `[McpToolHost] 警告: 工具 "${tool.name}" 已在模块 "${existing}" 中注册，` +
            `将被模块 "${module.name}" 覆盖`,
        )
      }
      this.toolToModule.set(tool.name, module.name)
    }
    this.modules.set(module.name, module)
    console.log(`[McpToolHost] 已注册工具模块: ${module.name} (${module.tools.length} 个工具)`)
  }

  /**
   * 获取所有已注册的工具定义
   */
  getAllTools(): ToolDefinition[] {
    const all: ToolDefinition[] = []
    for (const module of this.modules.values()) {
      if (this.disabledModules.has(module.name)) continue
      all.push(...module.tools)
    }
    return all
  }

  /** 返回所有已注册模块及其完整工具定义，供状态页审计。 */
  getRegisteredModules(): Array<{ name: string; enabled: boolean; tools: ToolDefinition[] }> {
    return Array.from(this.modules.values(), (module) => ({
      name: module.name,
      enabled: !this.disabledModules.has(module.name),
      tools: [...module.tools],
    }))
  }

  /** 立即启用或禁用一个已注册模块。 */
  setModuleEnabled(moduleName: string, enabled: boolean): boolean {
    if (!this.modules.has(moduleName)) return false
    if (enabled) this.disabledModules.delete(moduleName)
    else this.disabledModules.add(moduleName)
    return true
  }

  isModuleEnabled(moduleName: string): boolean {
    return this.modules.has(moduleName) && !this.disabledModules.has(moduleName)
  }

  /**
   * 创建一轮 MCP 工具会话。
   *
   * Claude Code 每次 sendMessage 都会拿到独立 MCP URL，工具调用回到这里时可恢复会话归属。
   */
  createToolSession(context: Omit<ToolExecutionContext, 'confirmationGranted'>): string {
    const token = randomUUID()
    const abortController = new AbortController()
    this.toolSessions.set(token, { ...context, abortSignal: abortController.signal })
    this.toolSessionAbortControllers.set(token, abortController)
    return token
  }

  /** 释放一轮 MCP 工具会话。 */
  releaseToolSession(token: string): void {
    this.toolSessions.delete(token)
    this.toolSessionAbortControllers.delete(token)
  }

  /** 取消中的 run 会撤销等待确认、通知在途工具，并等待所有本机工具调用真正结束。 */
  async cancelToolSession(token: string): Promise<void> {
    const context = this.toolSessions.get(token)
    this.toolSessions.delete(token)
    this.toolSessionAbortControllers.get(token)?.abort()
    this.toolSessionAbortControllers.delete(token)
    if (!context) return
    this.cancelledToolSessions.add(context)
    if (context.conversationId && context.agentRunId) {
      this.authorizationBroker.cancelForRun(context.conversationId, context.agentRunId)
    }
    const activeCalls = this.activeToolCalls.get(context)
    if (activeCalls?.size) await Promise.allSettled([...activeCalls])
  }

  /**
   * 启动 HTTP 服务器
   * @returns 实际监听端口
   */
  async start(): Promise<number> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (requestUrl.pathname !== '/mcp') {
          this.writeHttpError(res, 404, -32000, 'Not Found')
          return
        }
        const context = this.resolveRequestContext(req.url)
        if (!context) {
          this.writeHttpError(res, 401, -32001, 'Unauthorized')
          return
        }
        if (req.method !== 'POST') {
          this.writeHttpError(res, 405, -32000, 'Method Not Allowed')
          return
        }

        const declaredLength = this.readDeclaredContentLength(req)
        if (declaredLength !== null && declaredLength > MAX_MCP_REQUEST_BYTES) {
          this.writeHttpError(res, 413, -32002, 'Request body too large')
          return
        }

        const body = await this.readRequestBody(req)
        if (!body) {
          this.writeHttpError(res, 400, -32700, 'Parse error')
          return
        }

        // 支持批量请求或单请求
        const requests = Array.isArray(body) ? body : [body]
        if (requests.length === 0 || requests.length > MAX_MCP_BATCH_REQUESTS) {
          this.writeHttpError(res, 400, -32600, 'Invalid request batch')
          return
        }
        const results = await Promise.all(requests.map((r) => this.handleJsonRpc(r, context)))

        const resultList = results.filter((r) => r !== null)
        if (resultList.length === 0) {
          // 全部是 notification（无 id），返回 202
          res.writeHead(202)
          res.end()
          return
        }

        const responseBody = resultList.length === 1 ? resultList[0] : resultList
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(responseBody))
      } catch (err) {
        if (err instanceof McpHttpRequestError) {
          if (!res.headersSent) {
            this.writeHttpError(res, err.status, err.rpcCode, err.message)
          }
          return
        }
        console.error('[McpToolHost] 请求处理错误:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(jsonRpcError(null, -32603, 'Internal error')))
        }
      }
    })

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          console.log(`[McpToolHost] MCP server 已启动: 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('无法获取 MCP server 端口'))
        }
      })

      this.httpServer!.on('error', (err) => {
        console.error('[McpToolHost] HTTP 服务器错误:', err)
        reject(err)
      })
    })
  }

  /**
   * 获取当前监听端口
   */
  getPort(): number {
    return this.port
  }

  /**
   * 关闭 HTTP 服务器
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
    for (const controller of this.toolSessionAbortControllers.values()) controller.abort()
    this.toolSessions.clear()
    this.toolSessionAbortControllers.clear()
    console.log('[McpToolHost] 已关闭')
  }

  private resolveRequestContext(rawUrl: string | undefined): McpRequestContext | null {
    const url = new URL(rawUrl ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') return null
    const token = url.searchParams.get('session')
    if (!token) return null
    return this.toolSessions.get(token) ?? null
  }

  private writeHttpError(
    res: ServerResponse,
    status: number,
    rpcCode: number,
    message: string,
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(jsonRpcError(null, rpcCode, message)))
  }

  private readDeclaredContentLength(req: IncomingMessage): number | null {
    const value = req.headers['content-length']
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : MAX_MCP_REQUEST_BYTES + 1
  }

  /**
   * 处理单个 JSON-RPC 请求
   * @returns 需要返回的响应对象；notification（无 id）返回 null
   */
  private async handleJsonRpc(
    req: JsonRpcRequest,
    context: McpRequestContext,
  ): Promise<object | null> {
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return jsonRpcError(null, -32600, 'Invalid request')
    }
    const { id, method, params } = req

    // Notification（无 id）不需要响应
    if (id === null || id === undefined) {
      return null
    }

    try {
      switch (method) {
        case 'initialize':
          return jsonRpcResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: 'cclink_studio',
              version: '1.0.0',
            },
          })

        case 'tools/list':
          return jsonRpcResult(id, {
            tools: this.getToolsForContext(context).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          })

        case 'tools/call': {
          const callParams = params as
            | { name?: string; arguments?: Record<string, unknown> }
            | undefined
          if (!callParams?.name) {
            return jsonRpcError(id, -32602, 'Invalid params: missing tool name')
          }

          const toolName = callParams.name
          const args = callParams.arguments ?? {}
          const result = await this.trackToolCall(
            context,
            this.handleToolCall(toolName, args, context),
          )
          return jsonRpcResult(id, result)
        }

        case 'notifications/initialized':
          // 忽略 notification
          return jsonRpcResult(id, {})

        case 'ping':
          return jsonRpcResult(id, {})

        default:
          return jsonRpcError(id, -32601, `Method not found: ${method}`)
      }
    } catch (err) {
      console.error(`[McpToolHost] JSON-RPC 错误 (${method}):`, err)
      return jsonRpcError(id, -32603, `Internal error: ${(err as Error).message}`)
    }
  }

  /**
   * 执行工具调用（权限检查 → 模块路由 → 执行）
   */
  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: McpRequestContext,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    if (this.cancelledToolSessions.has(context)) return cancelledToolResult()
    const scheduledPolicyFailure = await validateScheduledTaskToolCall(toolName, args, context)
    if (scheduledPolicyFailure) {
      return {
        content: [{ type: 'text' as const, text: scheduledPolicyFailure }],
        isError: true,
      }
    }
    const moduleName = this.toolToModule.get(toolName)
    if (!moduleName) {
      const authorization = this.authorizationBroker.authorizeUnavailableTool(toolName)
      return {
        content: [
          {
            type: 'text' as const,
            text: authorization.reason ?? `错误：未找到工具 "${toolName}"`,
          },
        ],
        isError: true,
      }
    }

    const module = this.modules.get(moduleName)
    if (!module) {
      return {
        content: [{ type: 'text' as const, text: `错误：未找到工具模块 "${moduleName}"` }],
        isError: true,
      }
    }

    if (!this.isModuleEnabled(moduleName)) {
      return {
        content: [{ type: 'text' as const, text: `工具模块 "${moduleName}" 已在设置中禁用` }],
        isError: true,
      }
    }

    try {
      // 权限检查
      const toolDef = module.tools.find((t) => t.name === toolName)
      const annotations: ToolAnnotations | undefined = toolDef?.annotations
      const executionPolicy = await module.getExecutionPolicy?.(toolName, args, context)
      const authorization = await this.authorizationBroker.authorizeInternalTool({
        toolName,
        params: args,
        annotations,
        executionPolicy,
        context,
      })
      if (authorization.behavior === 'deny') {
        return {
          content: [
            {
              type: 'text' as const,
              text: authorization.reason ?? `工具授权被拒绝: ${toolName}`,
            },
          ],
          isError: true,
        }
      }
      if (this.cancelledToolSessions.has(context)) return cancelledToolResult()

      // 执行工具
      if (this.cancelledToolSessions.has(context)) return cancelledToolResult()
      const result = await module.execute(
        toolName,
        args,
        authorization.confirmationGranted ? { ...context, confirmationGranted: true } : context,
      )
      if (this.cancelledToolSessions.has(context)) return cancelledToolResult()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `操作失败: ${(err as Error).message}` }],
        isError: true,
      }
    }
  }

  private trackToolCall<T>(context: ToolExecutionContext, operation: Promise<T>): Promise<T> {
    let activeCalls = this.activeToolCalls.get(context)
    if (!activeCalls) {
      activeCalls = new Set()
      this.activeToolCalls.set(context, activeCalls)
    }
    const tracked = operation.finally(() => {
      activeCalls!.delete(tracked)
      if (activeCalls!.size === 0) this.activeToolCalls.delete(context)
    })
    activeCalls.add(tracked)
    return tracked
  }

  private getToolsForContext(context: McpRequestContext): ToolDefinition[] {
    const tools = this.getAllTools()
    const allowedTools = context.scheduledTaskPolicy?.allowedTools
    if (!allowedTools) return tools
    const allowlist = new Set(allowedTools)
    return tools.filter((tool) => allowlist.has(tool.name))
  }

  /**
   * 读取 HTTP 请求体
   */
  private readRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let receivedBytes = 0
      let settled = false
      const onData = (chunk: Buffer): void => {
        if (settled) return
        receivedBytes += chunk.length
        if (receivedBytes > MAX_MCP_REQUEST_BYTES) {
          settled = true
          chunks.length = 0
          req.off('data', onData)
          req.resume()
          reject(new McpHttpRequestError(413, -32002, 'Request body too large'))
          return
        }
        chunks.push(chunk)
      }
      req.on('data', onData)
      req.on('end', () => {
        if (settled) return
        settled = true
        const body = Buffer.concat(chunks).toString('utf-8')
        if (!body) {
          resolve(undefined)
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new McpHttpRequestError(400, -32700, 'Parse error'))
        }
      })
      req.on('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
    })
  }
}

function cancelledToolResult(): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return {
    content: [{ type: 'text', text: 'Agent run 已取消，工具调用未执行' }],
    isError: true,
  }
}

async function validateScheduledTaskToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: McpRequestContext,
): Promise<string | null> {
  const policy = context.scheduledTaskPolicy
  if (!policy) return null
  if (!policy.taskId || !policy.runId || policy.taskRevision < 1) {
    return '定时任务 correlation 不完整，已拒绝工具调用'
  }
  if (!policy.allowedTools.includes(toolName)) {
    return `定时任务不支持工具 "${toolName}"`
  }
  const pathValue =
    toolName === 'editor_read'
      ? args.filePath
      : toolName === 'editor_list'
        ? args.dirPath
        : undefined
  if (typeof pathValue !== 'string' || !isAbsolute(pathValue)) {
    return '定时任务文件工具必须提供工作空间内的绝对路径'
  }
  try {
    const canonical = await realpath(pathValue)
    const allowed = await Promise.all(policy.readRoots.map((root) => realpath(root)))
    if (!allowed.some((root) => isPathWithin(root, canonical))) {
      return '定时任务只能读取声明的工作空间资源'
    }
  } catch {
    return '定时任务声明的读取路径不可用'
  }
  return null
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const fromRoot = relative(resolve(rootPath), resolve(candidatePath))
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}
