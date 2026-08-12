/**
 * AgentBridge — AI 后端协调层
 *
 * 职责：
 * 1. 持有 IAgentBackend 实例（可插拔）
 * 2. 接收 IPC 请求，委托给后端
 * 3. 转发后端事件到渲染进程
 */

import type { BrowserWindow } from 'electron'
import type { PermissionManager } from '../mcp/permission'
import type { IAgentBackend, BackendConfig, AgentSendOptions } from './backend/types'
import {
  AgentRuntime,
  DEFAULT_CONVERSATION_ID,
  type AgentRuntimeEvent,
} from '../agent-core/runtime/agent-runtime'
import type { McpToolHost } from '../mcp/tool-host'
import type { McpClientManager } from '../mcp/client-manager'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { AdbBridge } from '../android/adb-bridge'
import type { BrowserManager } from '../browser/browser-manager'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import { DEFAULT_SETTINGS, type AppSettings } from '../settings/types'
import type { AgentScope } from './scope'
import { buildAgentMessageWithContext, type AgentSendMessageContext } from './message-context'
import { buildAgentResourceContext } from './resource-context'
import { workspaceRefKey } from '../../shared/workspace-ref'
import type {
  AgentCompactConversationPayload,
  AgentContextUsageSnapshot,
} from '../../shared/agent-protocol'
import { agentIpcEvents } from '../../shared/ipc/agent'
import { SessionDiagnosticReferenceStore } from './session-diagnostic-reference-store'
import type { ClaudeRuntimeProvenance } from '../../shared/claude-runtime'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import { managedClaudeIsolationEnvironment } from './managed-claude-environment'
import {
  AGENT_PROFILE_PROMPT_COMPILER_VERSION,
  BuiltinAgentRoleRegistry,
  type BuiltinAgentRole,
} from './agent-profile-registry'
import {
  agentRoleRefsEqual,
  createDefaultAgentConversationConfiguration,
  type AgentConversationConfiguration,
  type AgentRoleSummary,
  type AgentRunConfigurationReceipt,
} from '../../shared/agent-role'

const AGENT_EVENT_CHANNELS: Record<AgentRuntimeEvent['type'], string> = {
  stream: agentIpcEvents.stream,
  complete: agentIpcEvents.complete,
  error: agentIpcEvents.error,
  system: agentIpcEvents.stream,
}

export interface AgentBridgeOptions {
  agentEngine?: 'local-claude-code'
  backendType?: 'claude-code' | 'http-api'
  /** 主进程 ClaudeRuntimeManager 已探测的 Claude Code executable 绝对路径。 */
  claudeCodePath?: string
  /** Claude Code 运行时与 provider/model 组合的会话兼容指纹。 */
  sessionCompatibilityFingerprint?: string
  /** 已解析运行时的安全诊断投影，不包含绝对路径。 */
  runtimeProvenance?: ClaudeRuntimeProvenance
  /** API 格式（当前本地 Agent 路径使用 Anthropic-compatible 配置） */
  apiFormat?: 'anthropic' | 'openai'
  /** API 基础地址（Anthropic 格式时注入为 ANTHROPIC_BASE_URL） */
  apiBaseUrl?: string
  /** API 密钥 */
  apiKey?: string
  /** 模型名称 */
  modelName?: string
  /** 旧调用方的工作区回退；正常发送优先使用会话自身 workspaceRef。 */
  getWorkspacePath?: () => string
  /** 获取当前设置快照，用于构建 Agent 资源事实包。 */
  getSettingsSnapshot?: () => AppSettings
  /** agent-device 语义层是否可用（透传给后端，用于工具上下文 prompt） */
  agentDeviceAvailable?: () => boolean
  /**
   * 浏览器管理器（可选，晚绑定）。
   * browser scope 切换时用它把目标 Tab 拉到前台（setActive），对齐「操作过程可视化」。
   * BrowserManager 在 createWindow 阶段先于 AgentBridge 构造，可通过 setter 注入。
   */
  browserManager?: BrowserManager
  /** 浏览器任务运行时：browser scope 下自动创建/收束 BrowserTaskRun。 */
  browserTaskRuntime?: BrowserTaskRuntime
  /** 只记录、不控制调用的统一用量账本。 */
  usageLedgerService?: UsageLedgerService
}

export class AgentBridge {
  private mainWindow: BrowserWindow | null
  private readonly runtime: AgentRuntime
  private readonly permissionManager: PermissionManager
  private readonly activeBrowserTaskIds = new Map<string, string>()
  private readonly sessionDiagnosticRefs = new SessionDiagnosticReferenceStore()
  private readonly roleRegistry = new BuiltinAgentRoleRegistry()
  private readonly conversationConfigurations = new Map<string, AgentConversationConfiguration>()
  private readonly deps: {
    playwrightBridge: PlaywrightBridge | null
    toolHost: McpToolHost
    mcpClientMgr: McpClientManager
    adbBridge: AdbBridge | null
    agentDeviceAvailable?: () => boolean
    browserManager?: BrowserManager
    browserTaskRuntime?: BrowserTaskRuntime
    getSettingsSnapshot?: () => AppSettings
    usageLedgerService?: UsageLedgerService
  }
  private readonly getWorkspacePath?: () => string
  private configurationChangePending = false
  private sessionCompatibilityFingerprint: string | null
  private runtimeProvenance: ClaudeRuntimeProvenance | null
  private readonly runtimeListeners = new Set<(event: AgentRuntimeEvent) => void>()
  constructor(
    mainWindow: BrowserWindow,
    playwrightBridge: PlaywrightBridge | null,
    toolHost: McpToolHost,
    permissionManager: PermissionManager,
    mcpClientMgr: McpClientManager,
    adbBridge: AdbBridge | null,
    options?: AgentBridgeOptions,
  ) {
    this.mainWindow = mainWindow
    this.permissionManager = permissionManager
    this.deps = {
      playwrightBridge,
      toolHost,
      mcpClientMgr,
      adbBridge,
      agentDeviceAvailable: options?.agentDeviceAvailable,
      browserManager: options?.browserManager,
      browserTaskRuntime: options?.browserTaskRuntime,
      getSettingsSnapshot: options?.getSettingsSnapshot,
      usageLedgerService: options?.usageLedgerService,
    }
    this.getWorkspacePath = options?.getWorkspacePath
    this.sessionCompatibilityFingerprint = options?.sessionCompatibilityFingerprint ?? null
    this.runtimeProvenance = options?.runtimeProvenance ?? null

    this.runtime = new AgentRuntime({
      config: this.buildBackendConfig(options),
      deps: {
        playwrightBridge: playwrightBridge ?? { getPage: () => null },
        toolHost,
        mcpClientMgr,
        adbBridge: adbBridge ?? { getDeviceId: () => null, isConnected: () => false },
        agentDeviceAvailable: options?.agentDeviceAvailable,
      },
      onEvent: (event) => this.handleRuntimeEvent(event),
    })
  }

  /**
   * 根据选项构建 BackendConfig
   *
   * M9 开源底座只创建本机 Claude Code 后端。
   * provider/apiFormat/apiKey 字段暂保留旧设置兼容，但不再决定后端能力。
   */
  private buildBackendConfig(options?: AgentBridgeOptions): BackendConfig {
    return {
      type: 'local-claude-code',
      claudeCode: {
        claudeCodePath: options?.claudeCodePath,
        env:
          options?.runtimeProvenance?.source === 'managed'
            ? {
                DISABLE_UPDATES: '1',
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                ...(options.claudeCodePath
                  ? managedClaudeIsolationEnvironment(options.claudeCodePath)
                  : {}),
              }
            : undefined,
        apiBaseUrl: options?.apiBaseUrl,
        apiKey: options?.apiKey,
        modelName: options?.modelName,
        getWorkspacePath: this.getWorkspacePath,
        hostContext: {
          hostName: 'CCLink Studio',
          mcpServerName: 'cclink_studio',
          androidControllerName: 'CCLink Studio',
        },
      },
    }
  }

  /** 发送用户消息 */
  async sendMessage(
    message: string,
    conversationId = DEFAULT_CONVERSATION_ID,
    context?: AgentSendMessageContext,
  ): Promise<AgentRunConfigurationReceipt> {
    if (this.configurationChangePending) {
      throw new Error('Agent 配置正在切换，请稍后重试')
    }
    const binding = this.bindConversationConfiguration(conversationId, context?.configuration)
    let runtimeSessionMode: AgentRunConfigurationReceipt['runtimeSessionMode'] = 'new'
    if (context?.sessionId !== undefined) {
      const restorableSessionId = this.resolveRestorableSessionId(
        conversationId,
        context.sessionId,
        context.sessionCompatibilityFingerprint,
      )
      this.runtime.restoreConversation(conversationId, restorableSessionId)
      runtimeSessionMode = restorableSessionId ? 'resumed' : 'new'
    }
    const sendPlan = this.resolveSendPlan(conversationId, context)
    if (sendPlan.options.forceVisibleBrowser) {
      await this.syncVisibleBrowserPage(sendPlan.browserTabId, sendPlan.workspaceKey)
    }
    const resourceContext = await buildAgentResourceContext({
      message,
      scope: this.runtime.getScope(conversationId),
      browserTabId: sendPlan.browserTabId,
      context,
      browserManager: this.deps.browserManager,
      playwrightBridge: this.deps.playwrightBridge,
      settings: this.deps.getSettingsSnapshot?.() ?? DEFAULT_SETTINGS,
    })
    this.startBrowserTaskIfNeeded(
      conversationId,
      message,
      sendPlan.browserTabId,
      sendPlan.workspaceKey,
      context?.runId ?? null,
    )
    try {
      await this.runtime.sendMessage(
        buildAgentMessageWithContext(message, {
          resources: context?.resources,
          skills: context?.skills,
        }),
        conversationId,
        {
          ...sendPlan.options,
          runId: context?.runId,
          images: context?.images,
          workspacePath: resourceContext.workspace.rootPath ?? undefined,
          resourceContext,
          continuity: context?.continuity,
          agentProfile: this.toAgentRoleContext(binding.role),
        },
      )
    } catch (error) {
      this.failActiveBrowserTask(conversationId, error)
      throw error
    }
    return {
      conversationId,
      runId: context?.runId ?? 'untracked',
      roleRef: binding.configuration.roleRef,
      configurationRevision: binding.configuration.revision,
      configurationFingerprint: this.getConversationCompatibilityFingerprint(conversationId),
      runtimeSessionMode,
    }
  }

  async sendScheduledTaskMessage(input: {
    message: string
    conversationId: string
    runId: string
    workspacePath: string
    taskId: string
    taskRevision: number
    readRoots: string[]
  }): Promise<void> {
    await this.runtime.sendMessage(input.message, input.conversationId, {
      runId: input.runId,
      workspacePath: input.workspacePath,
      allowedTools: ['mcp__cclink_studio__editor_read', 'mcp__cclink_studio__editor_list'],
      disableBuiltinTools: true,
      scheduledTaskPolicy: {
        origin: 'scheduled-task',
        taskId: input.taskId,
        taskRevision: input.taskRevision,
        runId: input.runId,
        workspaceRoot: input.workspacePath,
        readRoots: input.readRoots,
        allowedTools: ['editor_read', 'editor_list'],
      },
    })
  }

  onRuntimeEvent(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  }

  async getContextUsage(
    conversationId = DEFAULT_CONVERSATION_ID,
  ): Promise<AgentContextUsageSnapshot | null> {
    return this.runtime.getContextUsage(conversationId)
  }

  async compactConversation(
    conversationId: string,
    payload: AgentCompactConversationPayload,
  ): Promise<void> {
    if (this.isBusy(conversationId)) throw new Error('Agent 正在响应中，暂时不能压缩上下文')
    const binding = this.bindConversationConfiguration(conversationId, payload.configuration)
    const sessionId = payload.sessionId.trim()
    if (!sessionId) throw new Error('当前会话还没有可压缩的 Claude SDK session')
    const compatibleSessionId = this.resolveRestorableSessionId(
      conversationId,
      sessionId,
      payload.sessionCompatibilityFingerprint,
    )
    if (!compatibleSessionId) {
      throw new Error(
        '当前 Claude SDK session 与已启用的 Agent 运行时不兼容，请发送新消息开始新会话',
      )
    }
    this.runtime.restoreConversation(conversationId, compatibleSessionId)
    const workspacePath =
      payload.workspaceRef?.kind === 'local'
        ? payload.workspaceRef.path
        : this.getWorkspacePath?.() || undefined
    await this.runtime.compactConversation(conversationId, payload.instructions, {
      runId: payload.runId,
      workspacePath,
      agentProfile: this.toAgentRoleContext(binding.role),
    })
  }

  private resolveSendPlan(
    conversationId: string,
    context?: AgentSendMessageContext,
  ): {
    options: AgentSendOptions
    browserTabId: string | null
    workspaceKey: string | null
  } {
    const scope = this.runtime.getScope(conversationId)
    const workspaceKey = context?.workspaceRef ? workspaceRefKey(context.workspaceRef) : null
    const explicitBrowserTabId = this.getMountedBrowserTabId(context, workspaceKey)
    const scopedBrowserTabId = scope.kind === 'browser' ? scope.instanceId : null
    this.assertBrowserWorkspace(scopedBrowserTabId, workspaceKey)
    const browserTabId = explicitBrowserTabId ?? scopedBrowserTabId
    const forceVisibleBrowser = Boolean(browserTabId)

    return {
      options: { forceVisibleBrowser },
      browserTabId,
      workspaceKey,
    }
  }

  private getMountedBrowserTabId(
    context: AgentSendMessageContext | undefined,
    workspaceKey: string | null,
  ): string | null {
    for (const resource of context?.resources ?? []) {
      if ((resource.kind === 'browser' || resource.ref.type === 'browser') && resource.ref.tabId) {
        if (resource.ref.workspaceKey !== undefined && resource.ref.workspaceKey !== workspaceKey) {
          throw new Error('挂载的浏览器资源不属于当前会话项目，已拒绝跨项目操作')
        }
        this.assertBrowserWorkspace(resource.ref.tabId, workspaceKey)
        return resource.ref.tabId
      }
    }
    return null
  }

  private assertBrowserWorkspace(tabId: string | null, workspaceKey: string | null): void {
    if (!tabId) return
    const actualWorkspaceKey = this.deps.browserManager?.getViewWorkspaceKey?.(tabId)
    if (actualWorkspaceKey !== undefined && actualWorkspaceKey !== workspaceKey) {
      throw new Error('浏览器 Tab 不属于当前会话项目，已拒绝跨项目操作')
    }
  }

  private async syncVisibleBrowserPage(
    tabId: string | null,
    workspaceKey: string | null,
  ): Promise<void> {
    const visibleTabId = tabId ?? this.deps.browserManager?.getViewIdForWorkspace?.(workspaceKey)
    if (!visibleTabId) return
    this.assertBrowserWorkspace(visibleTabId, workspaceKey)
    try {
      if (this.deps.browserManager?.isWorkspaceActive(workspaceKey)) {
        this.deps.browserManager.setActive(visibleTabId)
      }
    } catch {
      // 浏览器管理器未接入或视图不存在，继续尝试同步 Playwright 注册表
    }
    try {
      await this.deps.playwrightBridge?.switchToPage(visibleTabId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[AgentBridge] 同步可视浏览器页失败 tabId=${visibleTabId}:`, message)
    }
  }

  /** 中止当前响应 */
  async abort(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    this.cancelActiveBrowserTask(conversationId)
    await this.runtime.abort(conversationId)
  }

  /** 获取后端状态 */
  getStatus(conversationId = DEFAULT_CONVERSATION_ID): {
    connected: boolean
    busy: boolean
    runId: string | null
    sessionId: string | null
    sessionCompatibilityFingerprint: string | null
    runtimeProvenance: ClaudeRuntimeProvenance | null
    conversationConfiguration: AgentConversationConfiguration
    profilePromptCompilerVersion: number
    sessionRef: string | null
    ready: boolean
  } {
    const status = this.runtime.getStatus(conversationId)
    const conversationConfiguration = this.getConversationConfiguration(conversationId)
    return {
      ...status,
      busy: this.runtime.isBusy(conversationId),
      sessionCompatibilityFingerprint: this.roleRegistry.buildConversationCompatibilityFingerprint(
        this.sessionCompatibilityFingerprint,
        conversationConfiguration.roleRef,
        conversationConfiguration.revision,
      ),
      conversationConfiguration,
      profilePromptCompilerVersion: AGENT_PROFILE_PROMPT_COMPILER_VERSION,
      runtimeProvenance: this.runtimeProvenance,
      sessionRef: this.getSessionDiagnosticRef(status.sessionId),
      ready: true,
    }
  }

  /** 后端是否正在处理一条消息（响应进行中） */
  isBusy(conversationId = DEFAULT_CONVERSATION_ID): boolean {
    return this.runtime.isBusy(conversationId)
  }

  beginConfigurationChange(): boolean {
    if (
      this.configurationChangePending ||
      this.runtime
        .getConversationIds()
        .some((conversationId) => this.runtime.isBusy(conversationId))
    ) {
      return false
    }
    this.configurationChangePending = true
    return true
  }

  endConfigurationChange(): void {
    this.configurationChangePending = false
  }

  /** 重置会话 */
  resetSession(conversationId = DEFAULT_CONVERSATION_ID): void {
    const sessionId = this.runtime.getStatus(conversationId).sessionId
    this.sessionDiagnosticRefs.delete(sessionId)
    this.runtime.resetSession(conversationId)
  }

  /** 恢复历史会话的后端 session id */
  restoreConversation(
    conversationId: string,
    sessionId: string | null,
    configuration: AgentConversationConfiguration,
    sessionCompatibilityFingerprint?: string | null,
  ): void {
    this.bindConversationConfiguration(conversationId, configuration)
    this.runtime.restoreConversation(
      conversationId,
      this.resolveRestorableSessionId(conversationId, sessionId, sessionCompatibilityFingerprint),
    )
  }

  listRoles(): AgentRoleSummary[] {
    return this.roleRegistry.list()
  }

  /** 销毁一个会话 backend（关闭历史会话时释放资源） */
  async closeConversation(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    this.cancelActiveBrowserTask(conversationId)
    const sessionId = this.runtime.getStatus(conversationId).sessionId
    this.sessionDiagnosticRefs.delete(sessionId)
    await this.runtime.closeConversation(conversationId)
    this.conversationConfigurations.delete(conversationId)
  }

  /**
   * 设置操作作用域
   *
   * - 响应进行中拒绝切换（运行中进程仍是旧 allowlist），并回传系统事件提示。
   * - browser scope：把目标 Tab 切为 Playwright 活跃页 + 拉到前台（setActive），对齐「操作过程可视化」。
   *   Phase 1 单页阶段 switchToPage 可能抛错（实例未登记），用 try/catch 兜底——
   *   收窄逻辑仍生效，寻址在 Phase 2 claimPageForView 接线后真正落地。
   *
   * @returns 成功与否（失败时已通过事件回传原因）
   */
  setScope(scope: AgentScope, conversationId = DEFAULT_CONVERSATION_ID): boolean {
    if (this.isBusy(conversationId)) {
      this.forwardToRenderer(
        'error',
        {
          type: 'error',
          message: 'AI 正在响应中，请等待完成后再切换操作目标',
        },
        conversationId,
      )
      return false
    }

    // browser scope：切 Playwright 活跃页 + 拉前台
    if (scope.kind === 'browser') {
      const bridge = this.deps.playwrightBridge
      if (!bridge) {
        this.forwardToRenderer(
          'error',
          {
            type: 'error',
            message: '浏览器自动化当前不可用，请切换到其他操作目标或查看能力诊断',
          },
          conversationId,
        )
        return false
      }
      bridge.switchToPage(scope.instanceId).catch((err: Error) => {
        // Phase 1：实例尚未在 PlaywrightBridge 登记（claimPageForView 在 Phase 2 接线）
        // 不阻断收窄——工具表/allowedTools 仍按 browser 收窄，Agent 用当前活跃页
        console.warn(
          `[AgentBridge] switchToPage(${scope.instanceId}) 失败，降级用当前活跃页:`,
          err.message,
        )
      })
      try {
        this.deps.browserManager?.setActive(scope.instanceId)
      } catch {
        // 浏览器管理器未接入或视图不存在，忽略
      }
    }

    this.runtime.setScope(scope, conversationId)
    console.log(
      `[AgentBridge] 操作作用域已切换: kind=${scope.kind}${scope.kind === 'browser' ? ` instance=${scope.instanceId}` : ''}`,
    )
    return true
  }

  /** 获取当前作用域 */
  getScope(conversationId = DEFAULT_CONVERSATION_ID): AgentScope {
    return this.runtime.getScope(conversationId)
  }

  /**
   * 把 browser scope 降级回 all（目标 Tab 被关闭等失效场景调用）
   * @internal 供 BrowserManager 失效回调触发
   */
  invalidateBrowserScope(instanceId: string): void {
    for (const conversationId of this.runtime.getConversationIds()) {
      const scope = this.runtime.getScope(conversationId)
      if (scope.kind === 'browser' && scope.instanceId === instanceId) {
        this.runtime.setScope({ kind: 'all' }, conversationId)
        this.forwardToRenderer(
          'system',
          {
            type: 'system',
            subtype: 'scope-invalidated',
            message: `操作目标浏览器实例 ${instanceId} 已关闭，作用域已切回「全部」`,
          },
          conversationId,
        )
        console.log(`[AgentBridge] browser scope 失效，降级回 all: ${instanceId}`)
      }
    }
  }

  /** 晚绑定 BrowserManager（createWindow 先于 AgentBridge 构造时用） */
  attachBrowserManager(browserManager: BrowserManager): void {
    this.deps.browserManager = browserManager
  }

  /** 获取当前后端 */
  getBackend(): IAgentBackend {
    return this.runtime.getBackend(DEFAULT_CONVERSATION_ID)
  }

  /** 切换后端（使用存储的依赖） */
  switchBackend(config: BackendConfig, preserveSessions = true): void {
    this.runtime.switchBackend(config, preserveSessions)
  }

  /** 根据 API 设置重新配置后端（用于设置变更时的热重载） */
  reconfigure(
    apiSettings: {
      agentEngine?: string
      claudeCodePath?: string
      apiFormat?: string
      apiBaseUrl?: string
      apiKey?: string
      modelName?: string
      sessionCompatibilityFingerprint?: string
      runtimeProvenance?: ClaudeRuntimeProvenance
    },
    options?: { forceResetSessions?: boolean },
  ): void {
    const config = this.buildBackendConfig({
      agentEngine: 'local-claude-code',
      claudeCodePath: apiSettings.claudeCodePath,
      apiBaseUrl: apiSettings.apiBaseUrl,
      apiKey: apiSettings.apiKey,
      modelName: apiSettings.modelName,
      runtimeProvenance: apiSettings.runtimeProvenance,
    })
    const nextFingerprint = apiSettings.sessionCompatibilityFingerprint ?? null
    const preserveSessions =
      options?.forceResetSessions !== true &&
      this.sessionCompatibilityFingerprint !== null &&
      this.sessionCompatibilityFingerprint === nextFingerprint
    this.switchBackend(config, preserveSessions)
    this.sessionCompatibilityFingerprint = nextFingerprint
    this.runtimeProvenance = apiSettings.runtimeProvenance ?? null
  }

  /** 销毁资源 */
  async destroy(): Promise<void> {
    this.mainWindow = null
    await this.runtime.destroy()
    this.activeBrowserTaskIds.clear()
    this.sessionDiagnosticRefs.clear()
    this.runtimeListeners.clear()
    this.conversationConfigurations.clear()
  }

  private handleRuntimeEvent(event: AgentRuntimeEvent): void {
    for (const listener of this.runtimeListeners) listener(event)
    const taskId = this.activeBrowserTaskIds.get(event.conversationId)
    if (taskId) {
      this.syncActiveBrowserTaskCorrelation(event.conversationId, taskId, event.runId)
    }
    if (event.type === 'complete') {
      this.recordAgentUsage(event)
      if (this.isErrorResult(event.data)) {
        this.failActiveBrowserTask(event.conversationId, event.data)
      } else {
        this.finishActiveBrowserTask(event.conversationId)
      }
    } else if (event.type === 'error') {
      this.failActiveBrowserTask(event.conversationId, event.data)
    }
    this.forwardToRenderer(event.type, event.data, event.conversationId, event.runId)
  }

  private recordAgentUsage(event: AgentRuntimeEvent): void {
    const ledger = this.deps.usageLedgerService
    if (!ledger || !event.data || typeof event.data !== 'object') return
    const totalCostUsd = (event.data as { total_cost_usd?: unknown }).total_cost_usd
    if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd)) return
    void ledger
      .record({
        conversationId: event.conversationId,
        ...(event.runId ? { runId: event.runId } : {}),
        source: 'agent-model',
        provider: 'claude-code',
        quantity: 1,
        unit: 'usd',
        amount: Math.max(0, totalCostUsd),
        estimated: false,
        status: this.isErrorResult(event.data) ? 'failed' : 'succeeded',
      })
      .catch((error) => {
        console.warn(
          '[AgentBridge] 记录 Agent 用量失败:',
          error instanceof Error ? error.message : String(error),
        )
      })
  }

  private startBrowserTaskIfNeeded(
    conversationId: string,
    message: string,
    browserTabId: string | null = null,
    workspaceKey: string | null = null,
    agentRunId: string | null = null,
  ): void {
    const scope = this.runtime.getScope(conversationId)
    const tabId = browserTabId ?? (scope.kind === 'browser' ? scope.instanceId : null)
    if (!tabId) return
    const runtime = this.deps.browserTaskRuntime
    if (!runtime) return

    const goal = message.trim().replace(/\s+/g, ' ').slice(0, 200) || '浏览器任务'
    const sessionId = this.runtime.getStatus(conversationId).sessionId
    const task = runtime.startTask({
      tabId,
      goal,
      correlation: {
        workspaceKey,
        conversationId,
        agentRunId,
        agentSessionRef: this.getSessionDiagnosticRef(sessionId),
        profileId: this.deps.browserManager?.getViewProfileId(tabId) ?? null,
      },
    })
    this.activeBrowserTaskIds.set(conversationId, task.id)
  }

  private finishActiveBrowserTask(conversationId: string): void {
    const taskId = this.resolveActiveBrowserTaskId(conversationId)
    if (!taskId) return
    this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    this.deps.browserTaskRuntime?.finishTask(taskId)
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private cancelActiveBrowserTask(conversationId: string): void {
    const taskId = this.resolveActiveBrowserTaskId(conversationId)
    if (!taskId) return
    this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    this.deps.browserTaskRuntime?.cancelTask(taskId)
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private failActiveBrowserTask(conversationId: string, error: unknown): void {
    const taskId = this.resolveActiveBrowserTaskId(conversationId)
    if (!taskId) return
    this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    this.deps.browserTaskRuntime?.failTask(taskId, {
      reason: 'unknown',
      errorMessage: this.extractErrorMessage(error),
    })
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private resolveActiveBrowserTaskId(conversationId: string): string | null {
    return (
      this.activeBrowserTaskIds.get(conversationId) ??
      this.deps.browserTaskRuntime?.getActiveTaskForConversation(conversationId)?.id ??
      null
    )
  }

  private syncActiveBrowserTaskCorrelation(
    conversationId: string,
    taskId: string,
    eventRunId: string | null = null,
  ): void {
    const status = this.runtime.getStatus(conversationId)
    this.deps.browserTaskRuntime?.updateCorrelation(taskId, {
      agentRunId: eventRunId ?? status.runId,
      agentSessionRef: this.getSessionDiagnosticRef(status.sessionId),
    })
  }

  private getSessionDiagnosticRef(sessionId: string | null): string | null {
    return this.sessionDiagnosticRefs.get(sessionId)
  }

  private isErrorResult(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { is_error?: unknown }).is_error === true
    )
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message)
    }
    return String(error)
  }

  /** 将后端事件转发到渲染进程 */
  private forwardToRenderer(
    type: AgentRuntimeEvent['type'],
    data: unknown,
    conversationId = DEFAULT_CONVERSATION_ID,
    runId: string | null = null,
  ): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    const channel = AGENT_EVENT_CHANNELS[type]
    if (channel) {
      const payload =
        typeof data === 'object' && data !== null
          ? {
              ...(data as Record<string, unknown>),
              conversationId,
              runId,
              sessionCompatibilityFingerprint:
                this.getConversationCompatibilityFingerprint(conversationId),
              conversationConfiguration: this.getConversationConfiguration(conversationId),
            }
          : {
              value: data,
              conversationId,
              runId,
              sessionCompatibilityFingerprint:
                this.getConversationCompatibilityFingerprint(conversationId),
              conversationConfiguration: this.getConversationConfiguration(conversationId),
            }
      this.mainWindow.webContents.send(channel, payload)
    }
  }

  private resolveRestorableSessionId(
    conversationId: string,
    sessionId: string | null,
    persistedFingerprint?: string | null,
  ): string | null {
    return resolveCompatibleClaudeSessionId(
      sessionId,
      persistedFingerprint,
      this.getConversationCompatibilityFingerprint(conversationId),
    )
  }

  private bindConversationConfiguration(
    conversationId: string,
    configuration: AgentConversationConfiguration | null | undefined,
  ): { role: BuiltinAgentRole; configuration: AgentConversationConfiguration } {
    const currentConfiguration = this.conversationConfigurations.get(conversationId)
    const requestedConfiguration =
      configuration ?? currentConfiguration ?? createDefaultAgentConversationConfiguration(0)
    const role = this.roleRegistry.resolve(requestedConfiguration.roleRef)
    const nextConfiguration: AgentConversationConfiguration = {
      schemaVersion: 1,
      roleRef: { roleId: role.id, version: role.version },
      revision: requestedConfiguration.revision,
      updatedAt: requestedConfiguration.updatedAt,
    }
    if (
      currentConfiguration &&
      (!agentRoleRefsEqual(currentConfiguration.roleRef, nextConfiguration.roleRef) ||
        currentConfiguration.revision !== nextConfiguration.revision)
    ) {
      if (this.runtime.isBusy(conversationId)) {
        throw new Error('Agent 正在响应中，暂时不能切换角色')
      }
      this.runtime.resetSession(conversationId)
    }
    this.conversationConfigurations.set(conversationId, nextConfiguration)
    return { role, configuration: nextConfiguration }
  }

  private getConversationConfiguration(conversationId: string): AgentConversationConfiguration {
    return (
      this.conversationConfigurations.get(conversationId) ??
      createDefaultAgentConversationConfiguration(0)
    )
  }

  private getConversationCompatibilityFingerprint(conversationId: string): string | null {
    const configuration = this.getConversationConfiguration(conversationId)
    return this.roleRegistry.buildConversationCompatibilityFingerprint(
      this.sessionCompatibilityFingerprint,
      configuration.roleRef,
      configuration.revision,
    )
  }

  private toAgentRoleContext(
    role: BuiltinAgentRole,
  ): NonNullable<AgentSendOptions['agentProfile']> {
    return {
      ref: { roleId: role.id, version: role.version },
      label: role.label,
      ...(role.disclaimer ? { disclaimer: role.disclaimer } : {}),
      systemInstructions: role.systemInstructions,
    }
  }
}

export function resolveCompatibleClaudeSessionId(
  sessionId: string | null,
  persistedFingerprint: string | null | undefined,
  activeFingerprint: string | null,
): string | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!normalizedSessionId) return null
  if (!activeFingerprint || persistedFingerprint !== activeFingerprint) return null
  return normalizedSessionId
}
