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
import type { ToolModule, ToolDefinition, ToolAnnotations } from './types.js'

export interface ToolConfirmationInput {
  conversationId?: string
  toolName: string
  params: Record<string, unknown>
  riskLevel: 'read' | 'write' | 'destructive'
}

export interface ToolPermissionController {
  needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean
  requestConfirmation(request: ToolConfirmationInput): Promise<boolean>
}

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  jsonrpc: string
  id: number | string | null
  method: string
  params?: unknown
}

interface McpRequestContext {
  conversationId?: string
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
  /** 权限管理器 */
  private readonly permissionManager: ToolPermissionController
  /** 单轮 Agent 进程 → CCLink Studio 会话的短期映射 */
  private readonly toolSessions = new Map<string, string>()

  constructor(permissionManager: ToolPermissionController) {
    this.permissionManager = permissionManager
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
      all.push(...module.tools)
    }
    return all
  }

  /**
   * 创建一轮 MCP 工具会话。
   *
   * Claude Code 每次 sendMessage 都会拿到独立 MCP URL，工具调用回到这里时可恢复会话归属。
   */
  createToolSession(conversationId: string): string {
    const token = randomUUID()
    this.toolSessions.set(token, conversationId)
    return token
  }

  /** 释放一轮 MCP 工具会话。 */
  releaseToolSession(token: string): void {
    this.toolSessions.delete(token)
  }

  /**
   * 启动 HTTP 服务器
   * @returns 实际监听端口
   */
  async start(): Promise<number> {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const context = this.resolveRequestContext(req.url)
        if (req.method !== 'POST' || !context) {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(jsonRpcError(null, -32000, 'Method Not Allowed')))
          return
        }

        const body = await this.readRequestBody(req)
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(jsonRpcError(null, -32700, 'Parse error: empty body')))
          return
        }

        // 支持批量请求或单请求
        const requests = Array.isArray(body) ? body : [body]
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
    this.toolSessions.clear()
    console.log('[McpToolHost] 已关闭')
  }

  private resolveRequestContext(rawUrl: string | undefined): McpRequestContext | null {
    const url = new URL(rawUrl ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') return null
    const token = url.searchParams.get('session')
    if (!token) return {}
    return { conversationId: this.toolSessions.get(token) }
  }

  /**
   * 处理单个 JSON-RPC 请求
   * @returns 需要返回的响应对象；notification（无 id）返回 null
   */
  private async handleJsonRpc(
    req: JsonRpcRequest,
    context: McpRequestContext,
  ): Promise<object | null> {
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
              name: 'deepink',
              version: '1.0.0',
            },
          })

        case 'tools/list':
          return jsonRpcResult(id, {
            tools: this.getAllTools().map((t) => ({
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
          const result = await this.handleToolCall(toolName, args, context)
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
    const moduleName = this.toolToModule.get(toolName)
    if (!moduleName) {
      return {
        content: [{ type: 'text' as const, text: `错误：未找到工具 "${toolName}"` }],
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

    try {
      // 权限检查
      const toolDef = module.tools.find((t) => t.name === toolName)
      const annotations: ToolAnnotations | undefined = toolDef?.annotations

      if (this.permissionManager.needsConfirmation(toolName, annotations)) {
        const approved = await this.permissionManager.requestConfirmation({
          conversationId: context.conversationId,
          toolName,
          params: args,
          riskLevel: getRiskLevel(annotations),
        })

        if (!approved) {
          return {
            content: [{ type: 'text' as const, text: `用户拒绝了操作: ${toolName}` }],
            isError: true,
          }
        }
      }

      // 执行工具
      const result = await module.execute(toolName, args)
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

  /**
   * 读取 HTTP 请求体
   */
  private readRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        if (!body) {
          resolve(undefined)
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error(`无效的 JSON 请求体: ${body.slice(0, 100)}`))
        }
      })
      req.on('error', reject)
    })
  }
}

function getRiskLevel(annotations: ToolAnnotations | undefined): 'read' | 'write' | 'destructive' {
  if (!annotations) return 'write'
  if (annotations.destructiveHint) return 'destructive'
  if (annotations.readOnlyHint) return 'read'
  return 'write'
}
