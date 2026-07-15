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

export interface AgentBridgeOptions {
  agentEngine?: 'local-claude-code'
  backendType?: 'claude-code' | 'http-api'
  maxBudgetUsd?: number
  /** Claude Code CLI 路径；为空时由 LocalClaudeCodeBackend 交给 spawn 按 PATH 解析。 */
  claudeCodePath?: string
  /** API 格式（anthropic → CLI + env, openai → HTTP API） */
  apiFormat?: 'anthropic' | 'openai'
  /** API 基础地址（Anthropic 格式时注入为 ANTHROPIC_BASE_URL） */
  apiBaseUrl?: string
  /** API 密钥 */
  apiKey?: string
  /** 模型名称 */
  modelName?: string
  /** 获取当前工作区路径（Claude Code 后端据此绑定 Agent 的 cwd，仅 CCLink Studio 进程内生效） */
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
}

export class AgentBridge {
  private mainWindow: BrowserWindow | null
  private readonly runtime: AgentRuntime
  private readonly permissionManager: PermissionManager
  private readonly activeBrowserTaskIds = new Map<string, string>()
  private readonly deps: {
    playwrightBridge: PlaywrightBridge
    toolHost: McpToolHost
    mcpClientMgr: McpClientManager
    adbBridge: AdbBridge
    agentDeviceAvailable?: () => boolean
    browserManager?: BrowserManager
    browserTaskRuntime?: BrowserTaskRuntime
    getSettingsSnapshot?: () => AppSettings
  }
  private readonly getWorkspacePath?: () => string
  constructor(
    mainWindow: BrowserWindow,
    playwrightBridge: PlaywrightBridge,
    toolHost: McpToolHost,
    permissionManager: PermissionManager,
    mcpClientMgr: McpClientManager,
    adbBridge: AdbBridge,
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
    }
    this.getWorkspacePath = options?.getWorkspacePath

    this.runtime = new AgentRuntime({
      config: this.buildBackendConfig(options),
      deps: this.deps,
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
        maxBudgetUsd: options?.maxBudgetUsd,
        getWorkspacePath: this.getWorkspacePath,
        hostContext: {
          hostName: 'CCLink Studio',
          mcpServerName: 'deepink',
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
  ): Promise<void> {
    const sendPlan = this.resolveSendPlan(conversationId, message, context)
    if (sendPlan.options.forceVisibleBrowser) {
      await this.syncVisibleBrowserPage(sendPlan.browserTabId)
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
    this.startBrowserTaskIfNeeded(conversationId, message, sendPlan.browserTabId)
    try {
      await this.runtime.sendMessage(
        buildAgentMessageWithContext(message, { ...context, resourceContext }),
        conversationId,
        { ...sendPlan.options, resourceContext },
      )
    } catch (error) {
      this.failActiveBrowserTask(conversationId, error)
      throw error
    }
  }

  private resolveSendPlan(
    conversationId: string,
    message: string,
    context?: AgentSendMessageContext,
  ): { options: AgentSendOptions; browserTabId: string | null } {
    const scope = this.runtime.getScope(conversationId)
    const explicitBrowserTabId = this.getMountedBrowserTabId(context)
    const scopedBrowserTabId = scope.kind === 'browser' ? scope.instanceId : null
    const visibleBrowserTabId =
      scope.kind === 'all' && looksLikeBrowserTask(message)
        ? this.deps.browserManager?.getActiveViewId?.() ?? null
        : null
    const browserTabId = explicitBrowserTabId ?? scopedBrowserTabId ?? visibleBrowserTabId
    const forceVisibleBrowser = Boolean(browserTabId)

    return {
      options: { forceVisibleBrowser },
      browserTabId,
    }
  }

  private getMountedBrowserTabId(context?: AgentSendMessageContext): string | null {
    for (const resource of context?.resources ?? []) {
      if ((resource.kind === 'browser' || resource.ref.type === 'browser') && resource.ref.tabId) {
        return resource.ref.tabId
      }
    }
    return null
  }

  private async syncVisibleBrowserPage(tabId: string | null): Promise<void> {
    const visibleTabId = tabId ?? this.deps.browserManager?.getActiveViewId?.()
    if (!visibleTabId) return
    try {
      this.deps.browserManager?.setActive(visibleTabId)
    } catch {
      // 浏览器管理器未接入或视图不存在，继续尝试同步 Playwright 注册表
    }
    try {
      await this.deps.playwrightBridge.switchToPage(visibleTabId)
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
    sessionId: string | null
  } {
    return this.runtime.getStatus(conversationId)
  }

  /** 后端是否正在处理一条消息（响应进行中） */
  isBusy(conversationId = DEFAULT_CONVERSATION_ID): boolean {
    return this.runtime.isBusy(conversationId)
  }

  /** 重置会话 */
  resetSession(conversationId = DEFAULT_CONVERSATION_ID): void {
    this.runtime.resetSession(conversationId)
  }

  /** 恢复历史会话的后端 session id */
  restoreConversation(conversationId: string, sessionId: string | null): void {
    this.runtime.restoreConversation(conversationId, sessionId)
  }

  /** 销毁一个会话 backend（关闭历史会话时释放资源） */
  async closeConversation(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    this.cancelActiveBrowserTask(conversationId)
    await this.runtime.closeConversation(conversationId)
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
  switchBackend(config: BackendConfig): void {
    this.runtime.switchBackend(config)
  }

  /** 根据 API 设置重新配置后端（用于设置变更时的热重载） */
  reconfigure(apiSettings: {
    agentEngine?: string
    claudeCodePath?: string
    apiFormat?: string
    apiBaseUrl?: string
    apiKey?: string
    modelName?: string
    maxBudgetUsd?: number
  }): void {
    const config = this.buildBackendConfig({
      maxBudgetUsd: apiSettings.maxBudgetUsd,
      agentEngine: 'local-claude-code',
      claudeCodePath: apiSettings.claudeCodePath,
    })
    this.switchBackend(config)
  }

  /** 销毁资源 */
  async destroy(): Promise<void> {
    this.mainWindow = null
    await this.runtime.destroy()
    this.activeBrowserTaskIds.clear()
  }

  private handleRuntimeEvent(event: AgentRuntimeEvent): void {
    if (event.type === 'complete') {
      if (this.isErrorResult(event.data)) {
        this.failActiveBrowserTask(event.conversationId, event.data)
      } else {
        this.finishActiveBrowserTask(event.conversationId)
      }
    } else if (event.type === 'error') {
      this.failActiveBrowserTask(event.conversationId, event.data)
    }
    this.forwardToRenderer(event.type, event.data, event.conversationId)
  }

  private startBrowserTaskIfNeeded(
    conversationId: string,
    message: string,
    browserTabId: string | null = null,
  ): void {
    const scope = this.runtime.getScope(conversationId)
    const tabId = browserTabId ?? (scope.kind === 'browser' ? scope.instanceId : null)
    if (!tabId) return
    const runtime = this.deps.browserTaskRuntime
    if (!runtime) return

    const goal = message.trim().replace(/\s+/g, ' ').slice(0, 200) || '浏览器任务'
    const task = runtime.startTask({
      tabId,
      goal,
    })
    this.activeBrowserTaskIds.set(conversationId, task.id)
  }

  private finishActiveBrowserTask(conversationId: string): void {
    const taskId = this.activeBrowserTaskIds.get(conversationId)
    if (!taskId) return
    this.deps.browserTaskRuntime?.finishTask(taskId)
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private cancelActiveBrowserTask(conversationId: string): void {
    const taskId = this.activeBrowserTaskIds.get(conversationId)
    if (!taskId) return
    this.deps.browserTaskRuntime?.cancelTask(taskId)
    this.activeBrowserTaskIds.delete(conversationId)
  }

  private failActiveBrowserTask(conversationId: string, error: unknown): void {
    const taskId = this.activeBrowserTaskIds.get(conversationId)
    if (!taskId) return
    this.deps.browserTaskRuntime?.failTask(taskId, {
      reason: 'unknown',
      errorMessage: this.extractErrorMessage(error),
    })
    this.activeBrowserTaskIds.delete(conversationId)
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
    type: string,
    data: unknown,
    conversationId = DEFAULT_CONVERSATION_ID,
  ): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    // 映射后端事件类型到 IPC channel
    const channelMap: Record<string, string> = {
      stream: 'agent:stream',
      complete: 'agent:complete',
      error: 'agent:error',
      system: 'agent:stream',
    }

    const channel = channelMap[type]
    if (channel) {
      const payload =
        typeof data === 'object' && data !== null
          ? { ...(data as Record<string, unknown>), conversationId }
          : { value: data, conversationId }
      this.mainWindow.webContents.send(channel, payload)
    }
  }
}

function looksLikeBrowserTask(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  return /https?:\/\/|www\.|网页|网站|浏览器|打开|访问|搜索|百度|知乎|小红书|微博|公众号|登录|登陆|投稿|发布|点击|填写|上传|下载|截图|抓取|提取|页面|url|link|search|login|sign in|open|visit|click|submit|post/.test(
    normalized,
  )
}
