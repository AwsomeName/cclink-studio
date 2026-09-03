/**
 * AgentBridge — AI 后端协调层
 *
 * 职责：
 * 1. 持有 IAgentBackend 实例（可插拔）
 * 2. 接收 IPC 请求，委托给后端
 * 3. 转发后端事件到渲染进程
 */

import type { BrowserWindow } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
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
import type { BrowserTaskRun } from '../browser/browser-task-types'
import { DEFAULT_SETTINGS, type AppSettings } from '../settings/types'
import type { AgentScope } from './scope'
import { buildAgentMessageWithContext, type AgentSendMessageContext } from './message-context'
import { buildAgentResourceContext } from './resource-context'
import { workspaceRefKey } from '../../shared/workspace-ref'
import type {
  AgentAbortResult,
  AgentCompactConversationPayload,
  AgentContextUsageSnapshot,
  AgentRuntimeRunRecord,
} from '../../shared/agent-protocol'
import { agentIpcEvents } from '../../shared/ipc/agent'
import { SessionDiagnosticReferenceStore } from './session-diagnostic-reference-store'
import type { ClaudeRuntimeProvenance } from '../../shared/claude-runtime'
import {
  DEFAULT_AGENT_RUNTIME_BINDING,
  agentRuntimeBindingsEqual,
  normalizeAgentRuntimeBinding,
  type AgentRuntimeBinding,
} from '../../shared/agent-runtime'
import { CODEX_ACP_EXPECTED_VERSION } from '../agent-core/backends/local-acp-backend'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { CclinkAgentService, CclinkAgentEndpoint } from './cclink-agent-service'
import { AgentRuntimeStateStore, type TrustedAgentSessionRecord } from './agent-runtime-state-store'
import { managedClaudeIsolationEnvironment } from './managed-claude-environment'
import {
  AGENT_PROFILE_PROMPT_COMPILER_VERSION,
  BuiltinAgentRoleRegistry,
  type BuiltinAgentRole,
} from './agent-profile-registry'
import { BuiltinAgentSkillRegistry, type BuiltinAgentSkill } from './agent-skill-registry'
import type { AgentRoleRegistry } from './agent-role-registry'
import type { AgentSkillSummary } from '../../shared/agent-skill'
import { CLAUDE_NATIVE_SCHEDULING_POLICY_STATUS } from '../agent-core/backends/claude-native-scheduling-policy'
import {
  agentRoleRefsEqual,
  createDefaultAgentConversationConfiguration,
  type AgentConversationConfiguration,
  type AgentRoleSummary,
  type AgentRunConfigurationReceipt,
  type AgentSkillRef,
} from '../../shared/agent-role'
import { SUPPORTED_AGENT_API_FORMATS } from '../../shared/settings-constants'

export interface AgentBridgeOptions {
  /** 主进程角色定义唯一事实源；包含内置与 userData 本地不可变版本。 */
  roleRegistry?: AgentRoleRegistry
  agentEngine?: 'local-claude-code'
  backendType?: 'claude-code' | 'http-api'
  /** 主进程 ClaudeRuntimeManager 已探测的 Claude Code executable 绝对路径。 */
  claudeCodePath?: string
  /** Claude Code 运行时与 provider/model 组合的会话兼容指纹。 */
  sessionCompatibilityFingerprint?: string
  /** 已解析运行时的安全诊断投影，不包含绝对路径。 */
  runtimeProvenance?: ClaudeRuntimeProvenance
  /** 可选的 Codex ACP runtime；不会参与 Studio 启动门禁。 */
  codexAcpPath?: string
  codexApiKey?: string
  codexHome?: string
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
  /** 关联网页事务的临时运行结束后，通知持久状态 owner 收敛 Attempt。 */
  onCorrelatedBrowserTaskEnded?: (input: {
    workspacePath: string
    affairId: string
    attemptId: string
    browserTaskRunId: string
    executionGeneration: number
    launchOperationId: string
    tabId: string
    browserViewRuntimeGeneration: number
    webContentsId: number
    playwrightConnectionGeneration: number
    playwrightPageBindingGeneration: number
    reason: string
  }) => Promise<void> | void
  /** 只记录、不控制调用的统一用量账本。 */
  usageLedgerService?: UsageLedgerService
  /** 主进程近期 run 与可信 Runtime Session 的持久状态仓库。 */
  runtimeStateStore?: AgentRuntimeStateStore
  /** 显式实验开关启动的本机 chatcc HTTP/SSE 服务；不参与默认 Claude 路径。 */
  experimentalCclinkAgent?: CclinkAgentEndpoint & { service: CclinkAgentService }
}

export interface AgentBridgeDestroyOptions {
  /** App 退出时只持久化所有权状态并发出停止信号，不等待不可控的在途工作。 */
  waitForActiveRuns?: boolean
}

export class AgentBridge {
  private mainWindow: BrowserWindow | null
  private readonly runtime: AgentRuntime
  private readonly permissionManager: PermissionManager
  private readonly activeBrowserTaskIds = new Map<string, string>()
  private readonly sessionDiagnosticRefs = new SessionDiagnosticReferenceStore()
  private readonly roleRegistry: BuiltinAgentRoleRegistry | AgentRoleRegistry
  private readonly skillRegistry = new BuiltinAgentSkillRegistry()
  private readonly conversationConfigurations = new Map<string, AgentConversationConfiguration>()
  private readonly conversationSkills = new Map<string, BuiltinAgentSkill[]>()
  private readonly conversationRuntimeBindings = new Map<string, AgentRuntimeBinding>()
  /** 主进程观察并验证过的 Claude session 缓存；持久信任由 runtimeStateStore 提供。 */
  private readonly trustedClaudeSessions = new Map<string, TrustedAgentSessionRecord>()
  private readonly deps: {
    playwrightBridge: PlaywrightBridge | null
    toolHost: McpToolHost
    mcpClientMgr: McpClientManager
    adbBridge: AdbBridge | null
    agentDeviceAvailable?: () => boolean
    browserManager?: BrowserManager
    browserTaskRuntime?: BrowserTaskRuntime
    onCorrelatedBrowserTaskEnded?: AgentBridgeOptions['onCorrelatedBrowserTaskEnded']
    getSettingsSnapshot?: () => AppSettings
    usageLedgerService?: UsageLedgerService
  }
  private readonly getWorkspacePath?: () => string
  private readonly codexHome: string
  private configurationChangePending = false
  private sessionCompatibilityFingerprint: string | null
  private runtimeProvenance: ClaudeRuntimeProvenance | null
  private defaultAgentConfig: BackendConfig
  private acpConfig: Extract<BackendConfig, { type: 'local-acp' }>
  private readonly cclinkAgentService: CclinkAgentService | null
  private readonly runtimeListeners = new Set<(event: AgentRuntimeEvent) => void>()
  private readonly rendererSuppressedConversationIds = new Set<string>()
  private readonly runtimeStateStore: AgentRuntimeStateStore
  private readonly conversationWorkspaceKeys = new Map<string, string | null>()
  private readonly cancellingRuns = new Map<string, Promise<void>>()
  private readonly runtimeEpoch = Date.now()
  constructor(
    mainWindow: BrowserWindow,
    playwrightBridge: PlaywrightBridge | null,
    toolHost: McpToolHost,
    permissionManager: PermissionManager,
    mcpClientMgr: McpClientManager,
    adbBridge: AdbBridge | null,
    options?: AgentBridgeOptions,
  ) {
    this.runtimeStateStore = options?.runtimeStateStore ?? new AgentRuntimeStateStore()
    this.mainWindow = mainWindow
    this.permissionManager = permissionManager
    this.roleRegistry = options?.roleRegistry ?? new BuiltinAgentRoleRegistry()
    this.deps = {
      playwrightBridge,
      toolHost,
      mcpClientMgr,
      adbBridge,
      agentDeviceAvailable: options?.agentDeviceAvailable,
      browserManager: options?.browserManager,
      browserTaskRuntime: options?.browserTaskRuntime,
      onCorrelatedBrowserTaskEnded: options?.onCorrelatedBrowserTaskEnded,
      getSettingsSnapshot: options?.getSettingsSnapshot,
      usageLedgerService: options?.usageLedgerService,
    }
    this.getWorkspacePath = options?.getWorkspacePath
    this.codexHome = options?.codexHome ?? ''
    this.sessionCompatibilityFingerprint = options?.sessionCompatibilityFingerprint ?? null
    this.runtimeProvenance = options?.runtimeProvenance ?? null
    this.defaultAgentConfig = this.buildBackendConfig(options)
    this.acpConfig = this.buildAcpBackendConfig(options)
    this.cclinkAgentService = options?.experimentalCclinkAgent?.service ?? null

    this.runtime = new AgentRuntime({
      config: this.defaultAgentConfig,
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
    if (
      options?.apiFormat &&
      !SUPPORTED_AGENT_API_FORMATS.includes(
        options.apiFormat as (typeof SUPPORTED_AGENT_API_FORMATS)[number],
      )
    ) {
      throw new Error('OpenAI Compatible Agent 后端尚未实现')
    }
    if (options?.experimentalCclinkAgent) {
      return {
        type: 'cclink-agent',
        cclinkAgent: {
          baseUrl: options.experimentalCclinkAgent.baseUrl,
          token: options.experimentalCclinkAgent.token,
          runtimeId: options.experimentalCclinkAgent.runtimeId,
          getWorkspacePath: this.getWorkspacePath,
        },
      }
    }
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

  private buildAcpBackendConfig(
    options?: Pick<AgentBridgeOptions, 'codexAcpPath' | 'codexApiKey' | 'codexHome'>,
  ): Extract<BackendConfig, { type: 'local-acp' }> {
    return {
      type: 'local-acp',
      acp: {
        implementationId: 'codex-acp',
        executablePath: options?.codexAcpPath,
        apiKey: options?.codexApiKey,
        codexHome: options?.codexHome ?? this.codexHome,
        expectedVersion: CODEX_ACP_EXPECTED_VERSION,
        getWorkspacePath: this.getWorkspacePath,
        requestPermission: async (request) => {
          const authorization = await this.deps.toolHost.authorizeClassifiedTool({
            toolName: request.toolName,
            params: request.params,
            riskLevel: request.riskLevel,
            context: {
              conversationId: request.conversationId,
              agentRunId: request.runId,
            },
            reason: request.reason,
          })
          return authorization.behavior === 'allow'
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
    this.bindConversationRuntime(conversationId, context?.runtimeBinding)
    const binding = this.bindConversationConfiguration(conversationId, context?.configuration)
    const resolvedSkills = this.bindConversationSkills(conversationId, context?.skills ?? [])
    const runId = context?.runId?.trim() || `run-${randomUUID()}`
    const workspaceKey = context?.workspaceRef ? workspaceRefKey(context.workspaceRef) : null
    this.conversationWorkspaceKeys.set(conversationId, workspaceKey)
    let runtimeSessionMode: AgentRunConfigurationReceipt['runtimeSessionMode'] = 'new'
    const startedRun = await this.runtimeStateStore.beginRun({
      conversationId,
      runId,
      workspaceKey,
    })
    // Some product-owned runs (for example article publishing) start in main instead of
    // going through the renderer conversation controller. Publish the canonical run identity
    // before any stream event so the Agent panel can bind to it instead of discarding the
    // entire execution as a stale run.
    this.forwardRunStatus(startedRun)
    try {
      if (this.runtime.isBusy(conversationId)) {
        throw new Error('Agent 当前 Thread 已有活动任务，请等待完成或取消后重试')
      }
      if (context?.sessionId !== undefined && context.sessionId !== null) {
        const restorableSessionId = this.resolveRestorableSessionId(
          conversationId,
          context.sessionId,
          context.sessionCompatibilityFingerprint,
          workspaceKey,
        )
        if (!restorableSessionId) {
          throw new Error('请求的 Runtime Session 无法在当前工作区和运行时中恢复')
        }
        this.runtime.restoreConversation(conversationId, restorableSessionId)
        runtimeSessionMode = 'resumed'
      } else if (context?.sessionId === null) {
        this.runtime.restoreConversation(conversationId, null)
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
      const browserTask = this.startBrowserTaskIfNeeded(
        conversationId,
        message,
        sendPlan.browserTabId,
        sendPlan.workspaceKey,
        runId,
        context?.articlePublishingPolicy?.origin === 'article-publishing' ||
          context?.imageResearchPolicy?.origin === 'image-research',
      )
      await context?.onRunPrepared?.({
        conversationId,
        runId,
        browserTaskRunId: browserTask?.id ?? null,
      })
      await this.runtime.sendMessage(
        buildAgentMessageWithContext(message, {
          resources: context?.resources,
          skills: resolvedSkills.map((skill) => ({
            skillId: skill.skillId,
            version: skill.version,
            label: skill.label,
            description: skill.description,
            source: skill.source,
            contentHash: skill.contentHash,
            markdown: skill.markdown,
          })),
        }),
        conversationId,
        {
          ...sendPlan.options,
          runId,
          images: context?.images,
          workspacePath: resourceContext.workspace.rootPath ?? undefined,
          resourceContext,
          continuity: context?.continuity,
          articlePublishingPolicy: context?.articlePublishingPolicy,
          imageResearchPolicy: context?.imageResearchPolicy,
          agentProfile: this.toAgentRoleContext(binding.role),
        },
      )
    } catch (error) {
      this.failActiveBrowserTask(conversationId, error)
      const terminal = await this.runtimeStateStore.finishRun(conversationId, runId, 'failed', {
        code: 'run_start_failed',
        message: this.extractErrorMessage(error),
      })
      if (terminal) this.forwardRunStatus(terminal)
      throw error
    }
    return {
      conversationId,
      runId,
      roleRef: binding.configuration.roleRef,
      configurationRevision: binding.configuration.revision,
      configurationFingerprint: this.getConversationCompatibilityFingerprint(conversationId),
      runtimeSessionMode,
      skills: resolvedSkills.map((skill) => ({
        ref: { skillId: skill.skillId, version: skill.version },
        contentHash: skill.contentHash,
      })),
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
    const workspaceKey = workspaceRefKey({ kind: 'local', path: input.workspacePath })
    this.conversationWorkspaceKeys.set(input.conversationId, workspaceKey)
    const startedRun = await this.runtimeStateStore.beginRun({
      conversationId: input.conversationId,
      runId: input.runId,
      workspaceKey,
    })
    this.forwardRunStatus(startedRun)
    try {
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
    } catch (error) {
      const terminal = await this.runtimeStateStore.finishRun(
        input.conversationId,
        input.runId,
        'failed',
        {
          code: 'run_start_failed',
          message: this.extractErrorMessage(error),
        },
      )
      if (terminal) this.forwardRunStatus(terminal)
      throw error
    }
  }

  onRuntimeEvent(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  }

  /**
   * 为应用内部能力执行一次无工具、无会话续接的文本生成。
   * 结果不会进入普通 Agent 对话流；调用方仍需对文本做领域 schema 校验。
   */
  async requestInternalText(input: {
    purpose: string
    prompt: string
    workspacePath?: string
    timeoutMs?: number
  }): Promise<string> {
    if (this.configurationChangePending) {
      throw new Error('Agent 配置正在切换，请稍后重试')
    }
    const conversationId = `internal-${input.purpose}-${randomUUID()}`
    const runId = `run-${randomUUID()}`
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 180_000, 10_000), 300_000)
    this.rendererSuppressedConversationIds.add(conversationId)

    let timer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: () => void = () => undefined
    try {
      const result = new Promise<string>((resolve, reject) => {
        const finish = (callback: () => void): void => {
          if (timer) clearTimeout(timer)
          unsubscribe()
          callback()
        }
        unsubscribe = this.onRuntimeEvent((event) => {
          if (event.conversationId !== conversationId || event.runId !== runId) return
          if (event.type === 'complete') {
            const text =
              event.data && typeof event.data === 'object'
                ? (event.data as { result?: unknown }).result
                : null
            if (typeof text !== 'string' || !text.trim()) {
              finish(() => reject(new Error('Agent 未返回可解析的文本结果')))
              return
            }
            finish(() => resolve(text.trim()))
          } else if (event.type === 'error') {
            finish(() => reject(new Error(this.extractErrorMessage(event.data))))
          }
        })
        timer = setTimeout(() => {
          void this.runtime.abort(conversationId, runId).catch(() => undefined)
          finish(() => reject(new Error('Agent 生成超时，请稍后重试')))
        }, timeoutMs)
      })

      await this.runtime.sendMessage(input.prompt, conversationId, {
        runId,
        workspacePath: input.workspacePath,
        allowedTools: [],
        disableBuiltinTools: true,
      })
      return await result
    } finally {
      if (timer) clearTimeout(timer)
      unsubscribe()
      await this.runtime.closeConversation(conversationId).catch(() => undefined)
      this.rendererSuppressedConversationIds.delete(conversationId)
    }
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
    if (this.getConversationRuntimeBinding(conversationId).kind === 'acp') {
      throw new Error('Codex ACP 暂不支持手动压缩上下文')
    }
    if (this.isBusy(conversationId)) throw new Error('Agent 正在响应中，暂时不能压缩上下文')
    const binding = this.bindConversationConfiguration(conversationId, payload.configuration)
    const sessionId = payload.sessionId.trim()
    if (!sessionId) throw new Error('当前会话还没有可压缩的 Claude SDK session')
    const compatibleSessionId = this.resolveRestorableSessionId(
      conversationId,
      sessionId,
      payload.sessionCompatibilityFingerprint,
      payload.workspaceRef ? workspaceRefKey(payload.workspaceRef) : null,
    )
    if (!compatibleSessionId) {
      throw new Error(
        '当前 Claude SDK session 与已启用的 Agent 运行时不兼容，请发送新消息开始新会话',
      )
    }
    const workspacePath =
      payload.workspaceRef?.kind === 'local'
        ? payload.workspaceRef.path
        : this.getWorkspacePath?.() || undefined
    const workspaceKey = payload.workspaceRef ? workspaceRefKey(payload.workspaceRef) : null
    const runId = payload.runId?.trim() || `compact-${randomUUID()}`
    this.conversationWorkspaceKeys.set(conversationId, workspaceKey)
    await this.runtimeStateStore.beginRun({
      conversationId,
      runId,
      workspaceKey,
    })
    try {
      this.runtime.restoreConversation(conversationId, compatibleSessionId)
      await this.runtime.compactConversation(conversationId, payload.instructions, {
        runId,
        workspacePath,
        agentProfile: this.toAgentRoleContext(binding.role),
      })
    } catch (error) {
      await this.runtimeStateStore.finishRun(conversationId, runId, 'failed', {
        code: 'run_start_failed',
        message: this.extractErrorMessage(error),
      })
      throw error
    }
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
      options: {
        forceVisibleBrowser,
        allowedTools: context?.allowedTools,
        disableBuiltinTools: context?.disableBuiltinTools,
      },
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
      await this.deps.playwrightBridge?.switchToPage(visibleTabId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[AgentBridge] 同步可视浏览器页失败 tabId=${visibleTabId}:`, message)
    }
  }

  /** 精确取消指定 run；命令只发起取消，终态由 Runtime 结束确认后写入。 */
  async abort(conversationId: string, runId: string): Promise<AgentAbortResult> {
    const existing = this.runtimeStateStore.getRun(conversationId, runId)
    if (!existing) return { accepted: false, run: null, error: '未找到目标 Agent run' }
    if (
      existing.status === 'succeeded' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled'
    ) {
      return { accepted: existing.status === 'cancelled', run: existing }
    }
    const key = `${conversationId}\0${runId}`
    if (existing.status === 'cancelling' && this.cancellingRuns.has(key)) {
      return { accepted: true, run: existing }
    }
    if (this.runtime.getStatus(conversationId).runId !== runId) {
      return { accepted: false, run: existing, error: '目标 run 当前不由该 Runtime 执行' }
    }
    if (!this.runtime.supportsExactCancellation(conversationId)) {
      return {
        accepted: false,
        run: existing,
        error:
          'cclink-agent HTTP/SSE 服务缺少按 request_id 精确取消接口；Studio 未把断开流伪装成取消完成',
      }
    }

    this.runtime.reserveCancellation(conversationId, runId)
    let cancelling: AgentRuntimeRunRecord | null
    try {
      cancelling = await this.runtimeStateStore.markCancelling(conversationId, runId)
    } catch (error) {
      this.runtime.releaseCancellationReservation(conversationId, runId)
      throw error
    }
    if (!cancelling) {
      this.runtime.releaseCancellationReservation(conversationId, runId)
      return { accepted: false, run: null, error: '未找到目标 Agent run' }
    }
    if (cancelling.status !== 'cancelling') {
      this.runtime.releaseCancellationReservation(conversationId, runId)
      return {
        accepted: cancelling.status === 'cancelled',
        run: cancelling,
        error: cancelling.status === 'cancelled' ? undefined : '目标任务已自然结束',
      }
    }
    this.permissionManager.cancelForRun(conversationId, runId)
    this.cancelActiveBrowserTask(conversationId)
    this.forwardRunStatus(cancelling)

    if (!this.cancellingRuns.has(key)) {
      const cancellation = this.runtime
        .abort(conversationId, runId)
        .then(async () => {
          const terminal = await this.runtimeStateStore.finishRun(
            conversationId,
            runId,
            'cancelled',
          )
          if (terminal) this.forwardRunStatus(terminal)
        })
        .catch((error) => {
          console.warn(
            `[AgentBridge] run 取消尚未确认 conversation=${conversationId} run=${runId}:`,
            this.extractErrorMessage(error),
          )
        })
        .finally(() => {
          if (this.cancellingRuns.get(key) === cancellation) this.cancellingRuns.delete(key)
        })
      this.cancellingRuns.set(key, cancellation)
    }
    return { accepted: true, run: cancelling }
  }

  getRunStatus(conversationId: string, runId: string): AgentRuntimeRunRecord | null {
    return this.runtimeStateStore.getRun(conversationId, runId)
  }

  getActiveBrowserTask(conversationId: string): BrowserTaskRun | null {
    return this.deps.browserTaskRuntime?.getActiveTaskForConversation(conversationId) ?? null
  }

  getRuntimeIdentity(conversationId: string): {
    agentRuntimeBindingKey: string
    agentRuntimeEpoch: number
  } {
    return {
      agentRuntimeBindingKey: this.getRuntimeBindingKey(conversationId),
      agentRuntimeEpoch: this.runtimeEpoch,
    }
  }

  /** 获取后端状态 */
  getStatus(conversationId = DEFAULT_CONVERSATION_ID): {
    connected: boolean
    busy: boolean
    runId: string | null
    sessionId: string | null
    runtimeBinding: AgentRuntimeBinding
    sessionCompatibilityFingerprint: string | null
    runtimeProvenance: ClaudeRuntimeProvenance | null
    conversationConfiguration: AgentConversationConfiguration
    profilePromptCompilerVersion: number
    sessionRef: string | null
    ready: boolean
    nativeSchedulingPolicy?: typeof CLAUDE_NATIVE_SCHEDULING_POLICY_STATUS
  } {
    const status = this.runtime.getStatus(conversationId)
    const conversationConfiguration = this.getConversationConfiguration(conversationId)
    return {
      ...status,
      busy: this.runtime.isBusy(conversationId),
      runtimeBinding: this.getConversationRuntimeBinding(conversationId),
      sessionCompatibilityFingerprint: this.getConversationCompatibilityFingerprint(conversationId),
      conversationConfiguration,
      profilePromptCompilerVersion: AGENT_PROFILE_PROMPT_COMPILER_VERSION,
      runtimeProvenance:
        this.runtime.getBackendType(conversationId) === 'local-claude-code'
          ? this.runtimeProvenance
          : null,
      sessionRef: this.getSessionDiagnosticRef(status.sessionId),
      ready: true,
      ...(this.runtime.getBackendType(conversationId) === 'local-claude-code'
        ? { nativeSchedulingPolicy: CLAUDE_NATIVE_SCHEDULING_POLICY_STATUS }
        : {}),
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
    this.trustedClaudeSessions.delete(conversationId)
    void this.runtimeStateStore.clearSession(conversationId)
    this.runtime.resetSession(conversationId)
  }

  /** 恢复历史会话的后端 session id */
  restoreConversation(
    conversationId: string,
    sessionId: string | null,
    configuration: AgentConversationConfiguration,
    sessionCompatibilityFingerprint?: string | null,
    skills: AgentSkillRef[] = [],
    runtimeBinding?: AgentRuntimeBinding,
    workspaceKey: string | null = null,
  ): void {
    this.bindConversationRuntime(conversationId, runtimeBinding)
    this.bindConversationConfiguration(conversationId, configuration)
    this.bindConversationSkills(conversationId, skills)
    if (sessionId === null) {
      this.runtime.restoreConversation(conversationId, null)
      return
    }
    const compatibleSessionId = this.resolveRestorableSessionId(
      conversationId,
      sessionId,
      sessionCompatibilityFingerprint,
      workspaceKey,
    )
    if (!compatibleSessionId) {
      throw new Error('请求的 Runtime Session 无法在当前工作区和运行时中恢复')
    }
    this.conversationWorkspaceKeys.set(conversationId, workspaceKey)
    this.runtime.restoreConversation(conversationId, compatibleSessionId)
  }

  listRoles(): AgentRoleSummary[] {
    return this.roleRegistry.list()
  }

  listSkills(): AgentSkillSummary[] {
    return this.skillRegistry.list()
  }

  /** 销毁一个会话 backend（关闭历史会话时释放资源） */
  async closeConversation(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    const status = this.runtime.getStatus(conversationId)
    if (status.runId) {
      const aborted = await this.abort(conversationId, status.runId)
      if (!aborted.accepted) {
        throw new Error(aborted.error ?? '活动 Agent run 无法安全取消')
      }
      const cancellation = this.cancellingRuns.get(`${conversationId}\0${status.runId}`)
      if (cancellation) await cancellation
    }
    this.cancelActiveBrowserTask(conversationId)
    const sessionId = status.sessionId
    this.sessionDiagnosticRefs.delete(sessionId)
    await this.runtime.closeConversation(conversationId)
    this.trustedClaudeSessions.delete(conversationId)
    await this.runtimeStateStore.clearSession(conversationId)
    this.conversationWorkspaceKeys.delete(conversationId)
    this.conversationConfigurations.delete(conversationId)
    this.conversationSkills.delete(conversationId)
    this.conversationRuntimeBindings.delete(conversationId)
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

    // browser scope 只切自动化目标；原生 View 可见性由 renderer 当前 Tab 唯一决定。
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
    if (!preserveSessions) {
      this.trustedClaudeSessions.clear()
      for (const conversationId of this.runtime.getConversationIds()) {
        void this.runtimeStateStore.clearSession(conversationId)
      }
    }
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
      codexAcpPath?: string
      codexApiKey?: string
      codexHome?: string
      sessionCompatibilityFingerprint?: string
      runtimeProvenance?: ClaudeRuntimeProvenance
    },
    options?: { forceResetSessions?: boolean },
  ): void {
    if (this.defaultAgentConfig.type === 'cclink-agent') {
      const nextAcpConfig = this.buildAcpBackendConfig(apiSettings)
      this.runtime.reconfigureBackendType('local-acp', nextAcpConfig, false)
      this.acpConfig = nextAcpConfig
      return
    }
    const config = this.buildBackendConfig({
      agentEngine: 'local-claude-code',
      claudeCodePath: apiSettings.claudeCodePath,
      apiBaseUrl: apiSettings.apiBaseUrl,
      apiKey: apiSettings.apiKey,
      modelName: apiSettings.modelName,
      runtimeProvenance: apiSettings.runtimeProvenance,
    })
    this.defaultAgentConfig = config
    const nextFingerprint = apiSettings.sessionCompatibilityFingerprint ?? null
    const preserveSessions =
      options?.forceResetSessions !== true &&
      this.sessionCompatibilityFingerprint !== null &&
      this.sessionCompatibilityFingerprint === nextFingerprint
    this.switchBackend(config, preserveSessions)
    const nextAcpConfig = this.buildAcpBackendConfig(apiSettings)
    this.runtime.reconfigureBackendType('local-acp', nextAcpConfig, false)
    this.acpConfig = nextAcpConfig
    this.sessionCompatibilityFingerprint = nextFingerprint
    this.runtimeProvenance = apiSettings.runtimeProvenance ?? null
  }

  /** 销毁资源；普通调用严格等待，只有 App 明确退出时允许脱离未完成 run。 */
  async destroy(options: AgentBridgeDestroyOptions = {}): Promise<void> {
    this.mainWindow = null
    if (options.waitForActiveRuns === false) {
      // 先持久化 running/cancelling。Runtime 与工具若无法结束，下次启动会对账为
      // runtime_owner_lost；这里仍发出停止信号，但不能让 will-quit 无限等待。
      await this.runtimeStateStore.flush()
      void this.runtime.destroy().catch((error) => {
        console.warn('[AgentBridge] App 退出时 Runtime 后台清理未完成:', error)
      })
      await this.cclinkAgentService?.stop()
    } else {
      await this.runtime.destroy()
      await this.cclinkAgentService?.stop()
      await Promise.allSettled(this.cancellingRuns.values())
      await this.runtimeStateStore.flush()
    }
    this.activeBrowserTaskIds.clear()
    this.sessionDiagnosticRefs.clear()
    this.runtimeListeners.clear()
    this.rendererSuppressedConversationIds.clear()
    this.conversationConfigurations.clear()
    this.conversationSkills.clear()
    this.conversationRuntimeBindings.clear()
    this.conversationWorkspaceKeys.clear()
    this.cancellingRuns.clear()
    this.trustedClaudeSessions.clear()
  }

  private handleRuntimeEvent(event: AgentRuntimeEvent): void {
    if (
      event.type === 'system' &&
      typeof event.data === 'object' &&
      event.data !== null &&
      (event.data as { subtype?: unknown }).subtype === 'init'
    ) {
      void this.rememberTrustedClaudeSession(event.conversationId)
    }
    if (event.type === 'error' && !this.runtime.getStatus(event.conversationId).sessionId) {
      this.trustedClaudeSessions.delete(event.conversationId)
      void this.runtimeStateStore.clearSession(event.conversationId)
    }
    if ((event.type === 'complete' || event.type === 'error') && event.runId) {
      const tracked = this.runtimeStateStore.getRun(event.conversationId, event.runId)
      if (tracked) {
        void this.persistAndDeliverTerminalEvent(event, tracked)
        return
      }
    }
    this.deliverRuntimeEvent(this.normalizeBrowserTerminalEvent(event))
  }

  private async persistAndDeliverTerminalEvent(
    event: AgentRuntimeEvent,
    tracked: AgentRuntimeRunRecord,
  ): Promise<void> {
    try {
      // 取消流程独占 cancelled 终态：Runtime 的尾部 complete/error 不能绕过
      // backend.abort() 对 Query 退出和在途 Studio 工具排空的等待。
      if (tracked.status === 'cancelling') return
      const terminalEvent = this.normalizeBrowserTerminalEvent(event)
      const failed = terminalEvent.type === 'error' || this.isErrorResult(terminalEvent.data)
      const terminal = await this.runtimeStateStore.finishRun(
        terminalEvent.conversationId,
        terminalEvent.runId!,
        failed ? 'failed' : 'succeeded',
        failed
          ? {
              code: this.extractErrorCode(terminalEvent.data) ?? 'runtime_error',
              message: this.extractErrorMessage(terminalEvent.data),
            }
          : undefined,
      )
      this.deliverRuntimeEvent(terminalEvent)
      if (terminal) this.forwardRunStatus(terminal)
    } catch (error) {
      console.error(
        `[AgentBridge] 写入 run 终态失败 conversation=${event.conversationId} run=${event.runId}:`,
        this.extractErrorMessage(error),
      )
      this.deliverRuntimeEvent(event)
    }
  }

  private deliverRuntimeEvent(event: AgentRuntimeEvent): void {
    for (const listener of this.runtimeListeners) listener(event)
    const taskId = this.resolveBrowserTaskIdForEvent(event)
    if (taskId && event.type !== 'complete' && event.type !== 'error') {
      this.syncActiveBrowserTaskCorrelation(event.conversationId, taskId, event.runId)
    }
    if (event.type === 'complete') {
      this.recordAgentUsage(event)
      if (this.isErrorResult(event.data)) {
        this.failActiveBrowserTask(event.conversationId, event.data, taskId, event.runId)
      } else {
        this.finishActiveBrowserTask(event.conversationId, taskId, event.runId)
      }
    } else if (event.type === 'error') {
      this.failActiveBrowserTask(event.conversationId, event.data, taskId, event.runId)
    }
    if (!this.rendererSuppressedConversationIds.has(event.conversationId)) {
      this.forwardToRenderer(event.type, event.data, event.conversationId, event.runId)
    }
  }

  private normalizeBrowserTerminalEvent(event: AgentRuntimeEvent): AgentRuntimeEvent {
    if (event.type !== 'complete' || this.isErrorResult(event.data)) return event
    const taskId = this.resolveBrowserTaskIdForEvent(event)
    if (!taskId || !this.deps.browserTaskRuntime) return event
    const task =
      this.deps.browserTaskRuntime.getTask?.(taskId) ??
      this.deps.browserTaskRuntime.getActiveTaskForConversation(event.conversationId)
    if (!task) return event
    if (task.status === 'failed' || task.status === 'cancelled') {
      return this.browserCompletionError(
        event,
        'browser_task_not_successful',
        `关联 BrowserTask 已${task.status === 'failed' ? '失败' : '取消'}，Agent 本轮不能标记成功。`,
      )
    }
    if (task.status === 'paused' && task.takeoverReason) {
      return this.browserCompletionError(
        event,
        'browser_task_waiting_human',
        `浏览器任务已暂停，等待用户处理：${task.takeoverReason}`,
      )
    }
    if (task.reobservationRequired) {
      return this.browserCompletionError(
        event,
        'browser_reobservation_required',
        '浏览器动作结果仍未知，Agent 必须先重新截图或读取页面后才能完成本轮。',
      )
    }
    const actionLogs = this.deps.browserTaskRuntime.listActionLogs(taskId)
    if (actionLogs.some((log) => log.status === 'succeeded')) return event

    return this.browserCompletionError(
      event,
      'visible_browser_action_not_verified',
      'Agent 没有在绑定的可见浏览器 Tab 完成任何可验证操作，本轮已判定失败。' +
        '页面没有被打开或修改；请检查登录草稿是否已保存，或根据浏览器工具的失败信息处理。',
    )
  }

  private browserCompletionError(
    event: AgentRuntimeEvent,
    code: string,
    message: string,
  ): AgentRuntimeEvent {
    return {
      ...event,
      type: 'error',
      data: {
        type: 'error',
        code,
        message,
      },
    }
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
    deferAccountLease = false,
  ): BrowserTaskRun | null {
    const scope = this.runtime.getScope(conversationId)
    const tabId = browserTabId ?? (scope.kind === 'browser' ? scope.instanceId : null)
    if (!tabId) return null
    const runtime = this.deps.browserTaskRuntime
    if (!runtime) return null

    const goal = message.trim().replace(/\s+/g, ' ').slice(0, 200) || '浏览器任务'
    const sessionId = this.runtime.getStatus(conversationId).sessionId
    const accountId = deferAccountLease
      ? null
      : (this.deps.browserManager?.getViewAccountId(tabId) ?? null)
    const task = runtime.startTask({
      tabId,
      goal,
      correlation: {
        workspaceKey,
        conversationId,
        agentRunId,
        agentSessionRef: this.getSessionDiagnosticRef(sessionId),
        profileId: this.deps.browserManager?.getViewProfileId(tabId) ?? null,
        ...(accountId ? { accountId } : {}),
      },
    })
    this.activeBrowserTaskIds.set(conversationId, task.id)
    return task
  }

  private finishActiveBrowserTask(
    conversationId: string,
    resolvedTaskId?: string | null,
    agentRunId?: string | null,
  ): void {
    const taskId =
      resolvedTaskId === undefined
        ? this.resolveActiveBrowserTaskId(conversationId)
        : resolvedTaskId
    if (!taskId) return
    if (resolvedTaskId === undefined) this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    const task = this.deps.browserTaskRuntime?.getTask?.(taskId) ?? null
    this.deps.browserTaskRuntime?.finishTask(taskId)
    this.reconcileCorrelatedBrowserTasksEnd(
      conversationId,
      agentRunId ?? task?.correlation?.agentRunId ?? null,
      task,
      'Agent Run 已结束，但发布 Attempt 未进入终态',
    )
    if (this.activeBrowserTaskIds.get(conversationId) === taskId) {
      this.activeBrowserTaskIds.delete(conversationId)
    }
  }

  private cancelActiveBrowserTask(conversationId: string): void {
    const taskId = this.resolveActiveBrowserTaskId(conversationId)
    if (!taskId) return
    this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    const task = this.deps.browserTaskRuntime?.getTask?.(taskId) ?? null
    this.deps.browserTaskRuntime?.cancelTask(taskId)
    this.reconcileCorrelatedBrowserTasksEnd(
      conversationId,
      task?.correlation?.agentRunId ?? null,
      task,
      'Agent Run 或 BrowserTask 已取消',
    )
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private failActiveBrowserTask(
    conversationId: string,
    error: unknown,
    resolvedTaskId?: string | null,
    agentRunId?: string | null,
  ): void {
    const taskId =
      resolvedTaskId === undefined
        ? this.resolveActiveBrowserTaskId(conversationId)
        : resolvedTaskId
    if (!taskId) return
    if (resolvedTaskId === undefined) this.syncActiveBrowserTaskCorrelation(conversationId, taskId)
    const task = this.deps.browserTaskRuntime?.getTask?.(taskId) ?? null
    this.deps.browserTaskRuntime?.failTask(taskId, {
      reason: 'unknown',
      errorMessage: this.extractErrorMessage(error),
    })
    this.reconcileCorrelatedBrowserTasksEnd(
      conversationId,
      agentRunId ?? task?.correlation?.agentRunId ?? null,
      task,
      `Agent Run 或 BrowserTask 失败：${this.extractErrorMessage(error)}`,
    )
    if (this.activeBrowserTaskIds.get(conversationId) === taskId) {
      this.activeBrowserTaskIds.delete(conversationId)
    }
  }

  private resolveActiveBrowserTaskId(conversationId: string): string | null {
    return (
      this.activeBrowserTaskIds.get(conversationId) ??
      this.deps.browserTaskRuntime?.getActiveTaskForConversation(conversationId)?.id ??
      null
    )
  }

  private reconcileCorrelatedBrowserTaskEnd(task: BrowserTaskRun | null, reason: string): void {
    const callback = this.deps.onCorrelatedBrowserTaskEnded
    const correlation = task?.correlation
    if (
      !callback ||
      !task ||
      !correlation?.workspaceKey ||
      !correlation.affairId ||
      !correlation.affairAttemptId ||
      correlation.affairExecutionGeneration === undefined ||
      !correlation.affairLaunchOperationId ||
      correlation.browserViewRuntimeGeneration === undefined ||
      correlation.webContentsId === undefined ||
      correlation.playwrightConnectionGeneration === undefined ||
      correlation.playwrightPageBindingGeneration === undefined
    ) {
      return
    }
    const input = {
      workspacePath: correlation.workspaceKey,
      affairId: correlation.affairId,
      attemptId: correlation.affairAttemptId,
      browserTaskRunId: task.id,
      executionGeneration: correlation.affairExecutionGeneration,
      launchOperationId: correlation.affairLaunchOperationId,
      tabId: task.tabId,
      browserViewRuntimeGeneration: correlation.browserViewRuntimeGeneration,
      webContentsId: correlation.webContentsId,
      playwrightConnectionGeneration: correlation.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: correlation.playwrightPageBindingGeneration,
      reason: reason.slice(0, 1_000),
    }
    try {
      void Promise.resolve(callback(input)).catch((error) => {
        console.error(
          '[AgentBridge] 关联网页事务运行终态收敛失败:',
          this.extractErrorMessage(error),
        )
      })
    } catch (error) {
      console.error('[AgentBridge] 关联网页事务运行终态收敛失败:', this.extractErrorMessage(error))
    }
  }

  private reconcileCorrelatedBrowserTasksEnd(
    conversationId: string,
    agentRunId: string | null,
    primaryTask: BrowserTaskRun | null,
    reason: string,
  ): void {
    const candidates = [
      ...(primaryTask ? [primaryTask] : []),
      ...(agentRunId
        ? (this.deps.browserTaskRuntime?.listTasks?.() ?? []).filter(
            (task) =>
              task.correlation?.conversationId === conversationId &&
              task.correlation.agentRunId === agentRunId,
          )
        : []),
    ]
    const seenTasks = new Set<string>()
    const seenAttempts = new Set<string>()
    for (const task of candidates) {
      if (seenTasks.has(task.id)) continue
      seenTasks.add(task.id)
      const correlation = task.correlation
      const attemptKey =
        correlation?.workspaceKey && correlation.affairId && correlation.affairAttemptId
          ? `${correlation.workspaceKey}\u0000${correlation.affairId}\u0000${correlation.affairAttemptId}`
          : null
      if (attemptKey && seenAttempts.has(attemptKey)) continue
      if (attemptKey) seenAttempts.add(attemptKey)
      this.reconcileCorrelatedBrowserTaskEnd(task, reason)
    }
  }

  private resolveBrowserTaskIdForEvent(event: AgentRuntimeEvent): string | null {
    const runtime = this.deps.browserTaskRuntime
    if (event.runId && runtime?.getTaskForAgentRun) {
      return runtime.getTaskForAgentRun(event.conversationId, event.runId)?.id ?? null
    }
    return this.resolveActiveBrowserTaskId(event.conversationId)
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

  private extractErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('code' in error)) return null
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && code.trim() ? code.trim() : null
  }

  /** 将后端事件转发到渲染进程 */
  private forwardToRenderer(
    type: AgentRuntimeEvent['type'],
    data: unknown,
    conversationId = DEFAULT_CONVERSATION_ID,
    runId: string | null = null,
  ): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

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
    if (type === 'complete') {
      this.mainWindow.webContents.send(agentIpcEvents.complete, payload)
    } else if (type === 'error') {
      this.mainWindow.webContents.send(agentIpcEvents.error, payload)
    } else {
      this.mainWindow.webContents.send(agentIpcEvents.stream, payload)
    }
  }

  private forwardRunStatus(run: AgentRuntimeRunRecord): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send(agentIpcEvents.runStatus, run)
  }

  private resolveRestorableSessionId(
    conversationId: string,
    sessionId: string | null,
    persistedFingerprint?: string | null,
    workspaceKey?: string | null,
  ): string | null {
    const trusted =
      this.trustedClaudeSessions.get(conversationId) ??
      this.runtimeStateStore.getSession(conversationId)
    if (
      !trusted ||
      trusted.workspaceKey !== (workspaceKey ?? null) ||
      trusted.runtimeBindingKey !== this.getRuntimeBindingKey(conversationId)
    ) {
      return null
    }
    return resolveCompatibleClaudeSessionId(
      sessionId,
      persistedFingerprint,
      this.getConversationCompatibilityFingerprint(conversationId),
      trusted,
    )
  }

  private async rememberTrustedClaudeSession(conversationId: string): Promise<void> {
    if (this.getConversationRuntimeBinding(conversationId).kind !== 'claude-code') return
    const sessionId = this.runtime.getStatus(conversationId).sessionId?.trim()
    const compatibilityFingerprint = this.getConversationCompatibilityFingerprint(conversationId)
    if (!sessionId || !compatibilityFingerprint) return
    const record: TrustedAgentSessionRecord = {
      conversationId,
      sessionId,
      compatibilityFingerprint,
      workspaceKey: this.conversationWorkspaceKeys.get(conversationId) ?? null,
      runtimeBindingKey: this.getRuntimeBindingKey(conversationId),
      updatedAt: Date.now(),
    }
    this.trustedClaudeSessions.set(conversationId, record)
    await this.runtimeStateStore.rememberSession(record)
  }

  private getRuntimeBindingKey(conversationId: string): string {
    if (this.runtime.getBackendType(conversationId) === 'cclink-agent') {
      return 'cclink-agent:http-sse:1'
    }
    const binding = this.getConversationRuntimeBinding(conversationId)
    return binding.kind === 'acp' ? `acp:${binding.implementationId}` : 'claude-code'
  }

  private bindConversationRuntime(
    conversationId: string,
    requestedBinding?: AgentRuntimeBinding,
  ): AgentRuntimeBinding {
    const binding = normalizeAgentRuntimeBinding(
      requestedBinding ?? this.conversationRuntimeBindings.get(conversationId),
    )
    const current = this.conversationRuntimeBindings.get(conversationId)
    if (current && !agentRuntimeBindingsEqual(current, binding)) {
      throw new Error('已有 Thread 不能切换 Agent runtime，请新建 Thread')
    }
    this.runtime.bindConversationBackend(
      conversationId,
      binding.kind === 'acp' ? this.acpConfig : this.buildBackendConfigFromCurrentAgent(),
    )
    this.conversationRuntimeBindings.set(conversationId, binding)
    return binding
  }

  private buildBackendConfigFromCurrentAgent(): BackendConfig {
    return this.defaultAgentConfig
  }

  private getConversationRuntimeBinding(conversationId: string): AgentRuntimeBinding {
    return this.conversationRuntimeBindings.get(conversationId) ?? DEFAULT_AGENT_RUNTIME_BINDING
  }

  private getRuntimeCompatibilityFingerprint(conversationId: string): string | null {
    const binding = this.getConversationRuntimeBinding(conversationId)
    if (binding.kind === 'claude-code') return this.sessionCompatibilityFingerprint
    return createHash('sha256')
      .update(`local-acp|${binding.implementationId}|${CODEX_ACP_EXPECTED_VERSION}|protocol-1`)
      .digest('hex')
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

  private bindConversationSkills(
    conversationId: string,
    refs: AgentSkillRef[],
  ): BuiltinAgentSkill[] {
    const nextSkills = this.skillRegistry.resolveMany(refs)
    const currentSkills = this.conversationSkills.get(conversationId)
    if (currentSkills && !agentSkillSetsEqual(currentSkills, nextSkills)) {
      if (this.runtime.isBusy(conversationId)) {
        throw new Error('Agent 正在响应中，暂时不能修改 Skill')
      }
      this.runtime.resetSession(conversationId)
    }
    this.conversationSkills.set(conversationId, nextSkills)
    return nextSkills
  }

  private getConversationCompatibilityFingerprint(conversationId: string): string | null {
    const configuration = this.getConversationConfiguration(conversationId)
    const skills = this.conversationSkills.get(conversationId) ?? []
    return this.roleRegistry.buildConversationCompatibilityFingerprint(
      this.getRuntimeCompatibilityFingerprint(conversationId),
      configuration.roleRef,
      configuration.revision,
      skills.map((skill) => `${skill.skillId}@${skill.version}:${skill.contentHash}`),
    )
  }

  private toAgentRoleContext(
    role: BuiltinAgentRole,
  ): NonNullable<AgentSendOptions['agentProfile']> {
    return {
      ref: { roleId: role.id, version: role.version },
      label: role.label,
      ...(role.disclaimer ? { disclaimer: role.disclaimer } : {}),
      systemInstructions: this.roleRegistry.buildSystemInstructions(role),
    }
  }
}

function agentSkillSetsEqual(left: BuiltinAgentSkill[], right: BuiltinAgentSkill[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (skill, index) =>
        skill.skillId === right[index]?.skillId &&
        skill.version === right[index]?.version &&
        skill.contentHash === right[index]?.contentHash,
    )
  )
}

export function resolveCompatibleClaudeSessionId(
  sessionId: string | null,
  persistedFingerprint: string | null | undefined,
  activeFingerprint: string | null,
  trustedSession?: { sessionId: string; compatibilityFingerprint: string } | null,
): string | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!normalizedSessionId) return null
  if (!activeFingerprint || persistedFingerprint !== activeFingerprint) return null
  if (
    trustedSession?.sessionId !== normalizedSessionId ||
    trustedSession.compatibilityFingerprint !== activeFingerprint
  ) {
    return null
  }
  return normalizedSessionId
}
