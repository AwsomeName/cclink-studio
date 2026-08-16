/**
 * Agent IPC 处理器
 *
 * 管理所有 agent 相关的 IPC 通道：
 * - Claude Code CLI 后端通信（sendMessage / abort / stream 事件）
 * - 旧 Playwright 兼容入口（无项目归属，保留协议但禁用执行）
 */

import type { IpcMainInvokeEvent } from 'electron'
import type { AgentBridge } from '../agent/agent-bridge'
import type { AgentRoleRegistry } from '../agent/agent-role-registry'
import { listBuiltinAgentRoles } from '../agent/agent-profile-registry'
import { listBuiltinAgentSkills } from '../agent/agent-skill-registry'
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
import type { WorkspaceStateResolveResult } from '../../shared/ipc/workspace-state'
import type { ActiveLocalWorkspaceSnapshot } from '../../shared/ipc/workspace-state'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import {
  agentIpcContracts as agentIpc,
  agentMcpIpcContracts as agentMcpIpc,
} from '../../shared/ipc/agent-contract'
import {
  createDefaultAgentConversationConfiguration,
  type AgentConversationConfiguration,
  type AgentRoleRef,
} from '../../shared/agent-role'
import { legacyAgentProfileRefToRoleRef } from '../../shared/agent-profile'

interface AgentIpcDeps {
  trustedRendererGuard: TrustedRendererGuard
  getAgentBridge: () => AgentBridge | null
  getAgentRoleRegistry?: () => AgentRoleRegistry | null
  getDefaultAgentRoleRef?: () => AgentRoleRef
  permissionManager: PermissionManager
  getMcpClientMgr: () => McpClientManager | null
  getCapabilities?: () => AgentCapabilityStatus[]
  getToolModules?: () => AgentToolModuleStatus[]
  getActiveLocalWorkspace: () => ActiveLocalWorkspaceSnapshot
  resolveLocalWorkspace: (workspacePath: string) => Promise<WorkspaceStateResolveResult>
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
  const configuration: AgentConversationConfiguration | undefined = input.configuration
    ? input.configuration
    : input.profileRef
      ? createDefaultAgentConversationConfiguration(
          0,
          legacyAgentProfileRefToRoleRef(input.profileRef),
        )
      : undefined
  return {
    message: input.message,
    runtimeBinding: input.runtimeBinding,
    runId: typeof input.runId === 'string' && input.runId.trim() ? input.runId.trim() : undefined,
    resources: Array.isArray(input.resources) ? input.resources : undefined,
    skills: Array.isArray(input.skills) ? input.skills : undefined,
    images: Array.isArray(input.images) ? input.images : undefined,
    sessionId:
      input.sessionId === null || typeof input.sessionId === 'string' ? input.sessionId : undefined,
    sessionCompatibilityFingerprint:
      input.sessionCompatibilityFingerprint === null ||
      typeof input.sessionCompatibilityFingerprint === 'string'
        ? input.sessionCompatibilityFingerprint
        : undefined,
    configuration,
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
  const candidate = value as {
    kind?: unknown
    transport?: unknown
    endpointId?: unknown
    workspaceId?: unknown
    path?: unknown
    label?: unknown
    endpointName?: unknown
  }
  if (candidate.kind === 'global') return { kind: 'global' }
  if (candidate.kind === 'local' && typeof candidate.path === 'string') {
    const path = candidate.path.trim()
    return path ? { kind: 'local', path } : undefined
  }
  if (
    candidate.kind === 'remote' &&
    candidate.transport === 'cclink' &&
    typeof candidate.endpointId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.path === 'string'
  ) {
    return {
      kind: 'remote',
      transport: 'cclink',
      endpointId: candidate.endpointId.trim(),
      workspaceId: candidate.workspaceId.trim(),
      path: candidate.path.trim(),
      ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
      ...(typeof candidate.endpointName === 'string'
        ? { endpointName: candidate.endpointName }
        : {}),
    }
  }
  return undefined
}

async function bindTrustedConversationWorkspace(
  deps: Pick<AgentIpcDeps, 'getActiveLocalWorkspace' | 'resolveLocalWorkspace'>,
  bindings: Map<string, WorkspaceRef>,
  conversationId: string,
  requested: WorkspaceRef | undefined,
): Promise<WorkspaceRef> {
  const existing = bindings.get(conversationId)
  if (requested?.kind === 'remote') {
    throw new Error('远程工作区不能绑定到本地 Agent 会话')
  }
  if (requested?.kind === 'global') {
    if (existing?.kind === 'local') throw new Error('当前 Agent 会话已绑定其他本地工作空间')
    const globalRef = { kind: 'global' } as const
    bindings.set(conversationId, globalRef)
    return globalRef
  }
  if (!requested && existing?.kind === 'global') return existing

  const requestedPath = requested?.kind === 'local' ? requested.path : null
  const existingPath = existing?.kind === 'local' ? existing.path : null
  const activeAtStart = deps.getActiveLocalWorkspace()
  const currentPath = activeAtStart.workspacePath?.trim() ?? ''
  const candidatePath = requestedPath ?? existingPath ?? currentPath
  if (!candidatePath && !requested && !existing) {
    const globalRef = { kind: 'global' } as const
    bindings.set(conversationId, globalRef)
    return globalRef
  }
  if (!candidatePath || !currentPath) {
    throw new Error('当前 Agent 会话没有可验证的本地工作空间')
  }

  const [candidate, current] = await Promise.all([
    deps.resolveLocalWorkspace(candidatePath),
    deps.resolveLocalWorkspace(currentPath),
  ])
  if (!candidate.valid || !candidate.workspacePath || !current.valid || !current.workspacePath) {
    throw new Error('当前 Agent 工作空间不可用')
  }
  if (candidate.workspacePath !== current.workspacePath) {
    throw new Error('Agent 请求的工作空间与主进程当前工作空间不一致')
  }
  const activeAtCommit = deps.getActiveLocalWorkspace()
  if (
    activeAtCommit.generation !== activeAtStart.generation ||
    activeAtCommit.workspacePath !== current.workspacePath
  ) {
    throw new Error('Agent 绑定期间工作空间已发生变化，请重试')
  }

  const committedBinding = bindings.get(conversationId)
  const committedPath = committedBinding?.kind === 'local' ? committedBinding.path : null
  if (committedPath) {
    const bound = await deps.resolveLocalWorkspace(committedPath)
    if (!bound.valid || bound.workspacePath !== candidate.workspacePath) {
      throw new Error('当前 Agent 会话已绑定其他本地工作空间')
    }
  } else if (committedBinding) {
    throw new Error('当前 Agent 会话已绑定全局上下文，不能切换为本地工作空间')
  }

  const trusted = { kind: 'local' as const, path: candidate.workspacePath }
  bindings.set(conversationId, trusted)
  return trusted
}

/**
 * 注册所有 Agent 相关 IPC 处理器
 */
export function registerAgentIpc(deps: AgentIpcDeps): void {
  const conversationWorkspaceBindings = new Map<string, WorkspaceRef>()
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
    if (payload.workspaceRef?.kind === 'remote') {
      return {
        success: false,
        error: '远程工作区不能交给本地 Agent IPC 执行；请从 CCLink 远程会话面板发送。',
      }
    }
    const resolvedConversationId =
      typeof conversationId === 'string' ? conversationId : 'agent-default'
    let trustedWorkspaceRef: WorkspaceRef
    try {
      trustedWorkspaceRef = await bindTrustedConversationWorkspace(
        deps,
        conversationWorkspaceBindings,
        resolvedConversationId,
        payload.workspaceRef,
      )
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (payload.images?.length) {
      console.info(`[AgentIPC] 图片附件已接收: ${formatImageAttachmentDiagnostics(payload.images)}`)
    }
    const configurationReceipt = await agentBridge.sendMessage(
      payload.message,
      typeof conversationId === 'string' ? conversationId : undefined,
      {
        runId: payload.runId,
        runtimeBinding: payload.runtimeBinding,
        resources: payload.resources,
        skills: payload.skills,
        images: payload.images,
        sessionId: payload.sessionId,
        sessionCompatibilityFingerprint: payload.sessionCompatibilityFingerprint,
        configuration: payload.configuration,
        workspaceRef: trustedWorkspaceRef,
        continuity: payload.continuity,
      },
    )
    return { success: true, configurationReceipt }
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
        profilePromptCompilerVersion: undefined,
        runtimeProvenance: null,
        ready: false,
      }
    }
    return agentBridge.getStatus(conversationId)
  })

  handle(agentIpc.listRoles, () => {
    const roleRegistry = deps.getAgentRoleRegistry?.()
    if (roleRegistry) return roleRegistry.list()
    const agentBridge = requireAgentBridge()
    return agentBridge?.listRoles() ?? listBuiltinAgentRoles()
  })

  handle(agentIpc.createRole, (_event, draft) => {
    const registry = deps.getAgentRoleRegistry?.()
    return registry?.create(draft) ?? { success: false, error: '角色注册表未就绪' }
  })

  handle(agentIpc.updateRole, (_event, roleId, baseVersion, draft) => {
    const registry = deps.getAgentRoleRegistry?.()
    return (
      registry?.update(roleId, baseVersion, draft) ?? {
        success: false,
        error: '角色注册表未就绪',
      }
    )
  })

  handle(agentIpc.copyRole, (_event, ref) => {
    const registry = deps.getAgentRoleRegistry?.()
    return registry?.copy(ref) ?? { success: false, error: '角色注册表未就绪' }
  })

  handle(agentIpc.setRoleArchived, (_event, roleId, archived) => {
    const registry = deps.getAgentRoleRegistry?.()
    const defaultRoleRef = deps.getDefaultAgentRoleRef?.()
    if (archived && defaultRoleRef?.roleId === roleId) {
      return {
        success: false,
        error: '该角色是新会话默认角色；请先设置其他默认角色，再归档。',
      }
    }
    return (
      registry?.setArchived(roleId, archived) ?? {
        success: false,
        error: '角色注册表未就绪',
      }
    )
  })

  handle(agentIpc.exportRole, (_event, ref, parentDirectory) => {
    const registry = deps.getAgentRoleRegistry?.()
    return (
      registry?.export(ref, parentDirectory) ?? {
        success: false,
        error: '角色注册表未就绪',
      }
    )
  })

  handle(agentIpc.previewImportRole, (_event, roleJsonPath) => {
    const registry = deps.getAgentRoleRegistry?.()
    return (
      registry?.previewImport(roleJsonPath) ?? {
        success: false,
        error: '角色注册表未就绪',
      }
    )
  })

  handle(agentIpc.commitImportRole, (_event, token, decision) => {
    const registry = deps.getAgentRoleRegistry?.()
    return (
      registry?.commitImport(token, decision) ?? {
        success: false,
        error: '角色注册表未就绪',
      }
    )
  })

  handle(agentIpc.listSkills, () => {
    const agentBridge = requireAgentBridge()
    return agentBridge?.listSkills() ?? listBuiltinAgentSkills()
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
    if (input.workspaceRef?.kind === 'remote') {
      return {
        success: false,
        error: '远程会话不属于本地 Agent IPC，不能使用本地 Agent 压缩。',
      }
    }
    try {
      const trustedWorkspaceRef = await bindTrustedConversationWorkspace(
        deps,
        conversationWorkspaceBindings,
        conversationId,
        input.workspaceRef,
      )
      await agentBridge.compactConversation(conversationId, {
        sessionId: input.sessionId,
        sessionCompatibilityFingerprint: input.sessionCompatibilityFingerprint,
        configuration: input.configuration,
        runId: input.runId,
        workspaceRef: trustedWorkspaceRef,
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
    const [
      conversationId,
      sessionId,
      configuration,
      sessionCompatibilityFingerprint,
      skills,
      runtimeBinding,
    ] = args
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    agentBridge.restoreConversation(
      conversationId,
      sessionId,
      configuration,
      sessionCompatibilityFingerprint,
      skills,
      runtimeBinding,
    )
  })

  // 关闭指定会话并释放后端资源
  handle(agentIpc.closeConversation, async (_event, conversationId) => {
    const agentBridge = requireAgentBridge()
    if (!agentBridge) return
    await agentBridge.closeConversation(conversationId)
    conversationWorkspaceBindings.delete(conversationId)
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

function formatImageAttachmentDiagnostics(
  images: NonNullable<AgentSendMessagePayload['images']>,
): string {
  return `count=${images.length}, items=${images
    .map((image) => `${image.mediaType}:${image.size}`)
    .join(',')}`
}
