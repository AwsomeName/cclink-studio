import type {
  PermissionMode,
  ToolAnnotations,
  ToolExecutionContext,
  ToolExecutionPolicy,
} from './types.js'
import { deleteKillReasonFor } from './delete-kill-policy.js'

export interface ToolConfirmationInput {
  conversationId?: string
  runId?: string
  toolName: string
  params: Record<string, unknown>
  workspaceRoot?: string
  riskLevel: 'read' | 'write' | 'destructive'
  reason?: string
  allowAlways?: boolean
  /** 静态守卫说明（删除/终止类原因）；可安全展示给用户，不承载工具参数。 */
  guard?: string
}

export interface ToolPermissionController {
  needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean
  requestConfirmation(request: ToolConfirmationInput): Promise<boolean>
  /** 当前权限模式；真实控制器（PermissionManager）始终提供。缺失时按旧模式语义处理。 */
  getMode?(): PermissionMode
  cancelForRun?(conversationId: string, runId: string): void
}

export interface ToolAuthorizationResult {
  behavior: 'allow' | 'deny'
  reason?: string
  confirmationGranted?: boolean
}

interface InternalToolAuthorizationRequest {
  toolName: string
  params: Record<string, unknown>
  annotations: ToolAnnotations | undefined
  executionPolicy: ToolExecutionPolicy | null | undefined
  context: ToolExecutionContext
}

interface SdkToolAuthorizationRequest {
  toolName: string
  params: Record<string, unknown>
  context: ToolExecutionContext
  reason?: string
  authorizationId?: string
}

interface ClassifiedToolAuthorizationRequest {
  toolName: string
  params: Record<string, unknown>
  riskLevel: 'read' | 'write' | 'destructive'
  context: ToolExecutionContext
  reason?: string
}

interface CachedSdkAuthorization {
  decision: Promise<ToolAuthorizationResult>
  expiresAt: number
}

/** 统一确认决策的输出：allowed 直接放行；否则按确认参数请求用户确认。 */
interface ConfirmationPlan {
  allowed: boolean
  riskLevel: 'read' | 'write' | 'destructive'
  reason?: string
  /** 面向用户展示的静态守卫说明（删除/终止类）。 */
  guard?: string
  allowAlways?: false
}

const HUMAN_EXCLUSIVE_TOOLS = new Set(['android_shell', 'mcp__cclink_studio__android_shell'])

const SDK_READ_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'BashOutput',
  'TodoRead',
  'ToolSearch',
  'LSP',
  'ListMcpResources',
  'ReadMcpResource',
  'AskUserQuestion',
  'EnterPlanMode',
])

const SDK_WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'Agent',
  'TaskCreate',
  'TaskUpdate',
  'TodoWrite',
  'Skill',
  'ExitPlanMode',
])

const SDK_DESTRUCTIVE_TOOLS = new Set(['KillShell'])

/** Bash 不再全量登记为 destructive（ADR 0020 根因修复）：按命令内容判定删除/终止类。 */
const SDK_COMMAND_TOOLS = new Set(['Bash'])

/**
 * Agent 工具授权的唯一策略 owner。
 * PermissionManager 只负责用户交互和会话内 Always 记忆，不能决定安全下限。
 */
export class AgentToolAuthorizationBroker {
  private readonly sdkAuthorizations = new Map<string, CachedSdkAuthorization>()

  constructor(private readonly permissionController: ToolPermissionController) {}

  /** 当前权限模式；控制器未提供时按旧三模式语义处理。 */
  private currentMode(): PermissionMode | undefined {
    return this.permissionController.getMode?.()
  }

  cancelForRun(conversationId: string, runId: string): void {
    this.permissionController.cancelForRun?.(conversationId, runId)
  }

  async authorizeInternalTool(
    request: InternalToolAuthorizationRequest,
  ): Promise<ToolAuthorizationResult> {
    const humanExclusiveReason = humanExclusiveReasonFor(request.toolName)
    if (humanExclusiveReason) return { behavior: 'deny', reason: humanExclusiveReason }

    if (!request.annotations) {
      return {
        behavior: 'deny',
        reason: `工具 ${request.toolName} 没有登记安全分类，已按未知工具拒绝`,
      }
    }

    if (request.context.scheduledTaskPolicy) {
      return request.annotations.readOnlyHint && !request.annotations.destructiveHint
        ? { behavior: 'allow' }
        : {
            behavior: 'deny',
            reason: '定时任务授权链只允许既有只读工具',
          }
    }

    const plan = this.planConfirmation({
      toolName: request.toolName,
      params: request.params,
      annotations: request.annotations,
      executionPolicy: request.executionPolicy,
    })
    if (plan.allowed) return { behavior: 'allow' }

    const approved = await this.permissionController.requestConfirmation({
      conversationId: request.context.conversationId,
      runId: request.context.agentRunId ?? undefined,
      toolName: request.toolName,
      params: request.params,
      ...(request.context.trustedWorkspace?.kind === 'local'
        ? { workspaceRoot: request.context.trustedWorkspace.rootPath }
        : {}),
      riskLevel: plan.riskLevel,
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.guard ? { guard: plan.guard } : {}),
      ...(plan.allowAlways === false ? { allowAlways: false } : {}),
    })
    return approved
      ? { behavior: 'allow', confirmationGranted: true }
      : { behavior: 'deny', reason: `用户拒绝了操作: ${request.toolName}` }
  }

  authorizeUnavailableTool(toolName: string): ToolAuthorizationResult {
    const humanExclusiveReason = humanExclusiveReasonFor(toolName)
    if (humanExclusiveReason) return { behavior: 'deny', reason: humanExclusiveReason }
    return {
      behavior: 'deny',
      reason: `工具 ${toolName} 未登记安全分类，已按未知工具拒绝`,
    }
  }

  authorizeClassifiedTool(
    request: ClassifiedToolAuthorizationRequest,
  ): Promise<ToolAuthorizationResult> {
    // ACP 分类工具默认逐次确认；guarded 模式下 read/write 随模式放行，
    // destructive 分类与删除/终止类仍逐次确认（ADR 0020）。
    const guardedMode = this.currentMode() === 'auto-except-destructive'
    const deleteKillReason = deleteKillReasonFor(request.toolName, request.params)
    return this.authorizeInternalTool({
      toolName: request.toolName,
      params: request.params,
      annotations: annotationsForRiskLevel(request.riskLevel),
      executionPolicy: {
        riskLevel: request.riskLevel,
        requireConfirmation: guardedMode
          ? request.riskLevel === 'destructive' || deleteKillReason !== null
          : true,
        allowAlways: false,
        ...(request.reason ? { reason: request.reason } : {}),
      },
      context: request.context,
    })
  }

  authorizeSdkTool(request: SdkToolAuthorizationRequest): Promise<ToolAuthorizationResult> {
    if (!request.authorizationId) return this.evaluateSdkTool(request)
    const now = Date.now()
    this.pruneSdkAuthorizations(now)
    const cacheKey = [
      request.context.conversationId ?? '',
      request.context.agentRunId ?? '',
      request.toolName,
      request.authorizationId,
    ].join('\u0000')
    const cached = this.sdkAuthorizations.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.decision

    const decision = this.evaluateSdkTool(request)
    this.sdkAuthorizations.set(cacheKey, { decision, expiresAt: now + 2 * 60 * 1000 })
    return decision
  }

  private async evaluateSdkTool(
    request: SdkToolAuthorizationRequest,
  ): Promise<ToolAuthorizationResult> {
    const humanExclusiveReason = humanExclusiveReasonFor(request.toolName)
    if (humanExclusiveReason) return { behavior: 'deny', reason: humanExclusiveReason }

    if (request.toolName.startsWith('mcp__cclink_studio__')) {
      // Studio 内部 MCP 在 loopback ToolHost 执行前再次经过 authorizeInternalTool。
      return { behavior: 'allow' }
    }
    if (request.toolName.startsWith('mcp__')) {
      return {
        behavior: 'deny',
        reason: '外部 MCP 工具尚未建立登记分类和有界授权策略，已默认拒绝',
      }
    }

    // Bash 按命令内容判定删除/终止类（ADR 0020）：命中才映射为 destructive 注解。
    const deleteKillReason = deleteKillReasonFor(request.toolName, request.params)
    const annotations = sdkToolAnnotations(request.toolName, deleteKillReason)
    if (!annotations) {
      return {
        behavior: 'deny',
        reason: `SDK 工具 ${request.toolName} 没有登记安全分类，已默认拒绝`,
      }
    }
    const plan = this.planConfirmation({
      toolName: request.toolName,
      params: request.params,
      annotations,
      executionPolicy: null,
      ...(request.reason ? { fallbackReason: request.reason } : {}),
    })
    if (plan.allowed) return { behavior: 'allow' }

    const approved = await this.permissionController.requestConfirmation({
      conversationId: request.context.conversationId,
      runId: request.context.agentRunId ?? undefined,
      toolName: request.toolName,
      params: request.params,
      ...(request.context.trustedWorkspace?.kind === 'local'
        ? { workspaceRoot: request.context.trustedWorkspace.rootPath }
        : {}),
      riskLevel: plan.riskLevel,
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.guard ? { guard: plan.guard } : {}),
      ...(plan.allowAlways === false ? { allowAlways: false } : {}),
    })
    return approved
      ? { behavior: 'allow', confirmationGranted: true }
      : { behavior: 'deny', reason: `用户拒绝了操作: ${request.toolName}` }
  }

  /**
   * 统一确认决策（ADR 0020）。
   *
   * - 删除/终止类（deleteKillReason）在所有模式下逐次确认，且不可「始终允许」、
   *   不可被任务预授权（authorizationSatisfied）豁免。
   * - `auto-except-destructive` 模式：除删除/终止类与产品级 requireConfirmation 守卫外
   *   自动放行（含自声明 destructive 但非删除/终止的工具，如 browser_evaluate）。
   * - 旧三模式（auto/categorized/strict）维持原语义：destructive 注解下限 +
   *   PermissionManager.needsConfirmation 的模式判定。
   */
  private planConfirmation(input: {
    toolName: string
    params: Record<string, unknown>
    annotations: ToolAnnotations
    executionPolicy: ToolExecutionPolicy | null | undefined
    fallbackReason?: string
  }): ConfirmationPlan {
    const guardedMode = this.currentMode() === 'auto-except-destructive'
    const deleteKillReason = deleteKillReasonFor(input.toolName, input.params)
    const riskLevel = input.executionPolicy?.riskLevel ?? riskLevelFor(input.annotations)

    const destructiveFloor =
      deleteKillReason !== null || (!guardedMode && riskLevel === 'destructive')
    if (input.executionPolicy?.authorizationSatisfied === true && !destructiveFloor) {
      return { allowed: true, riskLevel }
    }

    const mandatoryConfirmation =
      destructiveFloor || input.executionPolicy?.requireConfirmation === true
    const modeConfirmation = guardedMode
      ? false
      : this.permissionController.needsConfirmation(input.toolName, input.annotations)
    if (!mandatoryConfirmation && !modeConfirmation) {
      return { allowed: true, riskLevel }
    }

    return {
      allowed: false,
      riskLevel: deleteKillReason ? 'destructive' : riskLevel,
      ...((deleteKillReason ?? input.executionPolicy?.reason ?? input.fallbackReason)
        ? {
            reason: deleteKillReason ?? input.executionPolicy?.reason ?? input.fallbackReason,
          }
        : {}),
      ...(deleteKillReason ? { guard: deleteKillReason } : {}),
      ...(mandatoryConfirmation || input.executionPolicy?.allowAlways === false
        ? { allowAlways: false as const }
        : {}),
    }
  }

  private pruneSdkAuthorizations(now: number): void {
    for (const [key, entry] of this.sdkAuthorizations) {
      if (entry.expiresAt <= now) this.sdkAuthorizations.delete(key)
    }
    while (this.sdkAuthorizations.size >= 2048) {
      const oldest = this.sdkAuthorizations.keys().next().value
      if (oldest === undefined) break
      this.sdkAuthorizations.delete(oldest)
    }
  }
}

function humanExclusiveReasonFor(toolName: string): string | null {
  if (!HUMAN_EXCLUSIVE_TOOLS.has(toolName)) return null
  return 'Android 任意 shell 不向普通 Agent 开放；请由用户在可见 Terminal/ADB 中人工接管'
}

function sdkToolAnnotations(
  toolName: string,
  deleteKillReason: string | null,
): ToolAnnotations | null {
  if (SDK_READ_TOOLS.has(toolName)) return { readOnlyHint: true, destructiveHint: false }
  if (SDK_WRITE_TOOLS.has(toolName)) return { readOnlyHint: false, destructiveHint: false }
  if (SDK_COMMAND_TOOLS.has(toolName)) {
    // Bash 的风险等级取决于命令内容：删除/终止类 → destructive，否则 write。
    return { readOnlyHint: false, destructiveHint: deleteKillReason !== null }
  }
  if (SDK_DESTRUCTIVE_TOOLS.has(toolName)) {
    return { readOnlyHint: false, destructiveHint: true }
  }
  return null
}

function riskLevelFor(annotations: ToolAnnotations): 'read' | 'write' | 'destructive' {
  if (annotations.destructiveHint) return 'destructive'
  if (annotations.readOnlyHint) return 'read'
  return 'write'
}

function annotationsForRiskLevel(riskLevel: 'read' | 'write' | 'destructive'): ToolAnnotations {
  return {
    readOnlyHint: riskLevel === 'read',
    destructiveHint: riskLevel === 'destructive',
  }
}
