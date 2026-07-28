/**
 * Agent IPC 处理器
 *
 * 管理所有 agent 相关的 IPC 通道：
 * - Claude Code CLI 后端通信（sendMessage / abort / stream 事件）
 * - 旧 Playwright 兼容入口（无项目归属，保留协议但禁用执行）
 */

import type { IpcMainInvokeEvent } from 'electron'
import type { AgentBridge } from '../agent/agent-bridge'
import type { PermissionManager } from '../mcp/permission'
import type { McpClientManager } from '../mcp/client-manager'
import type {
  AgentCapabilityStatus,
  AgentConversationContinuity,
  AgentSendMessageInput,
  AgentSendMessagePayload,
  AgentToolModuleStatus,
} from '../../shared/ipc/agent'
import type { WorkspaceRef } from '../../shared/workspace-ref'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import {
  agentIpcContracts as agentIpc,
  agentMcpIpcContracts as agentMcpIpc,
} from '../../shared/ipc/agent-contract'

interface AgentIpcDeps {
  trustedRendererGuard: TrustedRendererGuard
  getAgentBridge: () => AgentBridge | null
  permissionManager: PermissionManager
  getMcpClientMgr: () => McpClientManager | null
  getCapabilities?: () => AgentCapabilityStatus[]
  getToolModules?: () => AgentToolModuleStatus[]
  setToolModuleEnabled?: (
    moduleId: string,
    enabled: boolean,
  ) => Promise<{
    success: boolean
    error?: string
  }>
}

function normalizeSendMessageInput(input: AgentSendMessageInput): AgentSendMessagePayload {
  if (typeof input === 'string') return { message: input }
  return {
    message: input.message,
    runId: typeof input.runId === 'string' && input.runId.trim() ? input.runId.trim() : undefined,
    resources: Array.isArray(input.resources) ? input.resources : undefined,
    skills: Array.isArray(input.skills) ? input.skills : undefined,
    sessionId:
      input.sessionId === null || typeof input.sessionId === 'string' ? input.sessionId : undefined,
    sessionCompatibilityFingerprint:
      input.sessionCompatibilityFingerprint === null ||
      typeof input.sessionCompatibilityFingerprint === 'string'
        ? input.sessionCompatibilityFingerprint
        : undefined,
    workspaceRef: normalizeWorkspaceRef(input.workspaceRef),
    continuity: normalizeContinuity(input.continuity),
  }
}

function normalizeContinuity(value: unknown): AgentConversationContinuity | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as {
    recentMessages?: unknown
    tasks?: unknown
  }
  const recentMessages = Array.isArray(candidate.recentMessages)
    ? candidate.recentMessages.slice(-10).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const message = entry as { role?: unknown; text?: unknown }
        if (
          (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') ||
          typeof message.text !== 'string' ||
          !message.text.trim()
        ) {
          return []
        }
        return [
          {
            role: message.role,
            text: message.text.trim().slice(0, 1200),
          } as AgentConversationContinuity['recentMessages'][number],
        ]
      })
    : []
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks.slice(0, 12).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const task = entry as { content?: unknown; status?: unknown }
        if (
          typeof task.content !== 'string' ||
          !task.content.trim() ||
          (task.status !== 'pending' &&
            task.status !== 'in_progress' &&
            task.status !== 'completed')
        ) {
          return []
        }
        return [
          {
            content: task.content.trim().slice(0, 300),
            status: task.status,
          } as AgentConversationContinuity['tasks'][number],
        ]
      })
    : []
  return recentMessages.length > 0 || tasks.length > 0 ? { recentMessages, tasks } : undefined
}

function normalizeWorkspaceRef(value: unknown): WorkspaceRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { kind?: unknown; path?: unknown }
  if (candidate.kind === 'global') return { kind: 'global' }
  if (candidate.kind !== 'local' || typeof candidate.path !== 'string') return undefined
  const path = candidate.path.trim()
  return path ? { kind: 'local', path } : undefined
}

/**
 * 注册所有 Agent 相关 IPC 处理器
 */
export function registerAgentIpc(deps: AgentIpcDeps): void {
  const handle = <Args extends unknown[], Result>(
    contract: IpcInvokeContract<Args, Result>,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: NoInfer<Args>
    ) => NoInfer<Result> | Promise<NoInfer<Result>>,
  ): void => registerTrustedIpcContract(contract, deps.trustedRendererGuard, handler)
  const requireAgentBridge = (): AgentBridge | null => deps.getAgentBridge()
  const requireMcpClientMgr = (): McpClientManager | null => deps.getMcpClientMgr()
  const permissionManager = deps.permissionManager

  // ─── AI 后端通信 ─────────────────────────────────

  // 发送用户消息给 Claude Agent SDK 后端
  handle(agentIpc.sendMessage, async (_event, ...args) => {
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return { success: false, error: 'Agent 后端未就绪' }
    const conversationId = args.length === 2 ? args[0] : undefined
    const input = args.length === 2 ? args[1] : args[0]
    const payload = normalizeSendMessageInput(input)
    await agentBridge.sendMessage(
      payload.message,
      typeof conversationId === 'string' ? conversationId : undefined,
      {
        runId: payload.runId,
        resources: payload.resources,
        skills: payload.skills,
        images: payload.images,
        sessionId: payload.sessionId,
        sessionCompatibilityFingerprint: payload.sessionCompatibilityFingerprint,
        workspaceRef: payload.workspaceRef,
        continuity: payload.continuity,
      },
    )
    return { success: true }
  })

  // 中止当前 AI 响应
  handle(agentIpc.abort, async (_event, ...args) => {
    const [conversationId] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    await agentBridge.abort(conversationId)
  })

  // 获取 AI 后端状态
  handle(agentIpc.getStatus, (_event, ...args) => {
    const [conversationId] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) {
      return {
        connected: false,
        busy: false,
        sessionId: null,
        sessionCompatibilityFingerprint: null,
        runtimeProvenance: null,
        ready: false,
      }
    }
    return agentBridge.getStatus(conversationId)
  })

  handle(agentIpc.getContextUsage, async (_event, ...args) => {
    const [conversationId] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return null
    return agentBridge.getContextUsage(conversationId)
  })

  handle(agentIpc.compactConversation, async (_event, conversationId, input) => {
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return { success: false, error: 'Agent 后端未就绪' }
    try {
      await agentBridge.compactConversation(conversationId, {
        sessionId: input.sessionId,
        sessionCompatibilityFingerprint: input.sessionCompatibilityFingerprint,
        runId: input.runId,
        workspaceRef: input.workspaceRef,
        instructions: input.instructions,
      })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // 设置操作作用域（选择 Agent 操作目标 + 工具收窄）
  // 响应进行中切换会被拒绝（agentBridge 内部回传 error 事件）
  handle(agentIpc.setScope, (_event, ...args) => {
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return false
    const conversationId = args.length === 2 ? args[0] : undefined
    const scope = args.length === 2 ? args[1] : args[0]
    return agentBridge.setScope(scope, conversationId)
  })

  // 获取当前操作作用域
  handle(agentIpc.getScope, (_event, ...args) => {
    const [conversationId] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return { kind: 'all' as const }
    return agentBridge.getScope(conversationId)
  })

  // 清除会话（开始新对话）
  handle(agentIpc.resetSession, (_event, ...args) => {
    const [conversationId] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    agentBridge.resetSession(conversationId)
  })

  // 恢复历史会话的后端 session id
  handle(agentIpc.restoreConversation, (_event, ...args) => {
    const [conversationId, sessionId, sessionCompatibilityFingerprint] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    agentBridge.restoreConversation(conversationId, sessionId, sessionCompatibilityFingerprint)
  })

  // 关闭指定会话并释放后端资源
  handle(agentIpc.closeConversation, async (_event, conversationId) => {
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    await agentBridge.closeConversation(conversationId)
  })

  // 获取 Agent 可用能力状态（用于 UI 展示降级原因）
  handle(agentIpc.getCapabilities, () => {
    return deps.getCapabilities?.() ?? []
  })

  handle(agentIpc.listToolModules, () => deps.getToolModules?.() ?? [])

  handle(agentIpc.setToolModuleEnabled, (_event, moduleId, enabled) => {
    return (
      deps.setToolModuleEnabled?.(moduleId, enabled) ??
      Promise.resolve({ success: false, error: '工具模块管理器未就绪' })
    )
  })

  // ─── 权限管理 ──────────────────────────────────────

  // 渲染进程回传用户确认/拒绝
  handle(agentIpc.resolveToolConfirmation, (_event, ...args) => {
    const [id, approved, alwaysAllow] = args
    permissionManager.resolveConfirmation(id, approved, alwaysAllow)
  })

  // 获取当前权限模式
  handle(agentIpc.getPermissionMode, () => {
    return permissionManager.getMode()
  })

  // 设置权限模式
  handle(agentIpc.setPermissionMode, (_event, mode) => {
    permissionManager.setMode(mode)
  })

  // ─── 外部 MCP Server 管理 ──────────────────────────

  // 列出所有外部 server
  handle(agentMcpIpc.listServers, () => {
    const mcpClientMgr = requireMcpClientMgr()
    if (!mcpClientMgr) return []
    return mcpClientMgr.getAllServers()
  })

  // 添加外部 server
  handle(agentMcpIpc.addServer, (_event, server) => {
    const mcpClientMgr = requireMcpClientMgr()
    if (!mcpClientMgr) return { success: false, error: 'MCP 管理器未就绪' }
    try {
      mcpClientMgr.addServer(server)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 移除外部 server
  handle(agentMcpIpc.removeServer, (_event, name) => {
    const mcpClientMgr = requireMcpClientMgr()
    if (!mcpClientMgr) return false
    return mcpClientMgr.removeServer(name)
  })

  // 更新外部 server
  handle(agentMcpIpc.updateServer, (_event, name, updates) => {
    const mcpClientMgr = requireMcpClientMgr()
    if (!mcpClientMgr) return false
    return mcpClientMgr.updateServer(name, updates)
  })

  // 重新加载配置文件
  handle(agentMcpIpc.reloadConfig, () => {
    const mcpClientMgr = requireMcpClientMgr()
    if (!mcpClientMgr) return []
    mcpClientMgr.loadFromConfig()
    return mcpClientMgr.getAllServers()
  })
}
