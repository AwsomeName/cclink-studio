import type { ToolAnnotations, ToolExecutionContext, ToolExecutionPolicy } from './types.js'

export interface ToolConfirmationInput {
  conversationId?: string
  runId?: string
  toolName: string
  params: Record<string, unknown>
  workspaceRoot?: string
  riskLevel: 'read' | 'write' | 'destructive'
  reason?: string
  allowAlways?: boolean
}

export interface ToolPermissionController {
  needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean
  requestConfirmation(request: ToolConfirmationInput): Promise<boolean>
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

const SDK_DESTRUCTIVE_TOOLS = new Set(['Bash', 'KillShell'])

/**
 * Agent 工具授权的唯一策略 owner。
 * PermissionManager 只负责用户交互和会话内 Always 记忆，不能决定安全下限。
 */
export class AgentToolAuthorizationBroker {
  private readonly sdkAuthorizations = new Map<string, CachedSdkAuthorization>()

  constructor(private readonly permissionController: ToolPermissionController) {}

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

    const riskLevel = request.executionPolicy?.riskLevel ?? riskLevelFor(request.annotations)
    if (request.executionPolicy?.authorizationSatisfied === true && riskLevel !== 'destructive') {
      return { behavior: 'allow' }
    }
    const mandatoryConfirmation =
      riskLevel === 'destructive' || request.executionPolicy?.requireConfirmation === true
    const confirmationRequired =
      mandatoryConfirmation ||
      this.permissionController.needsConfirmation(request.toolName, request.annotations)
    if (!confirmationRequired) return { behavior: 'allow' }

    const approved = await this.permissionController.requestConfirmation({
      conversationId: request.context.conversationId,
      runId: request.context.agentRunId ?? undefined,
      toolName: request.toolName,
      params: request.params,
      ...(request.context.trustedWorkspace?.kind === 'local'
        ? { workspaceRoot: request.context.trustedWorkspace.rootPath }
        : {}),
      riskLevel,
      ...(request.executionPolicy?.reason ? { reason: request.executionPolicy.reason } : {}),
      ...(mandatoryConfirmation || request.executionPolicy?.allowAlways === false
        ? { allowAlways: false }
        : {}),
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
    return this.authorizeInternalTool({
      toolName: request.toolName,
      params: request.params,
      annotations: annotationsForRiskLevel(request.riskLevel),
      executionPolicy: {
        riskLevel: request.riskLevel,
        requireConfirmation: true,
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

    const annotations = sdkToolAnnotations(request.toolName)
    if (!annotations) {
      return {
        behavior: 'deny',
        reason: `SDK 工具 ${request.toolName} 没有登记安全分类，已默认拒绝`,
      }
    }
    const riskLevel = riskLevelFor(annotations)
    const mandatoryConfirmation = riskLevel === 'destructive'
    const confirmationRequired =
      mandatoryConfirmation ||
      this.permissionController.needsConfirmation(request.toolName, annotations)
    if (!confirmationRequired) return { behavior: 'allow' }

    const approved = await this.permissionController.requestConfirmation({
      conversationId: request.context.conversationId,
      runId: request.context.agentRunId ?? undefined,
      toolName: request.toolName,
      params: request.params,
      ...(request.context.trustedWorkspace?.kind === 'local'
        ? { workspaceRoot: request.context.trustedWorkspace.rootPath }
        : {}),
      riskLevel,
      ...(request.reason ? { reason: request.reason } : {}),
      ...(mandatoryConfirmation ? { allowAlways: false } : {}),
    })
    return approved
      ? { behavior: 'allow', confirmationGranted: true }
      : { behavior: 'deny', reason: `用户拒绝了操作: ${request.toolName}` }
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

function sdkToolAnnotations(toolName: string): ToolAnnotations | null {
  if (SDK_READ_TOOLS.has(toolName)) return { readOnlyHint: true, destructiveHint: false }
  if (SDK_WRITE_TOOLS.has(toolName)) return { readOnlyHint: false, destructiveHint: false }
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
