import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { parseScheduledTaskId } from '../../../../shared/scheduled-task/scheduled-task-schema'
import type {
  ScheduledTaskFailure,
  ScheduledTaskRun,
  ScheduledTaskSnapshot,
} from '../../../../shared/scheduled-task/scheduled-task-types'
import type { ScheduledTaskService } from '../../../scheduled-task/scheduled-task-service'
import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'

const DEFAULT_RUN_LIMIT = 20
const MAX_RUN_LIMIT = 50

const TOOLS: ToolDefinition[] = [
  {
    name: 'scheduled_task_list',
    description:
      '列出当前 Agent 会话所绑定本地工作空间中的 Studio 定时任务。返回名称、revision、本机启用状态、下次运行和最近运行摘要；不返回任务指令、资源正文或其他工作空间路径。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'scheduled_task_get_runtime_status',
    description:
      '读取当前 Agent 会话所绑定工作空间的 CCLink Studio 定时任务 Runtime 投影，包括 ready/degraded、下个 timer、队列、当前 run、本机启用数量和结构化错误。不会返回其他工作空间计数，也不会注册或查询系统计划任务。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'scheduled_task_list_runs',
    description:
      '列出当前工作空间中一个 Studio 定时任务的有界运行历史。只返回运行状态和时间摘要；当前切片不提供产物来源归因。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'scheduled_task_list 返回的任务 UUID' },
        limit: { type: 'number', description: '返回条数，默认 20，最小 1，最大 50' },
      },
      required: ['taskId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
]

export class ScheduledTaskToolModule implements ToolModule {
  readonly name = 'scheduled-task'
  readonly tools = TOOLS

  constructor(private readonly service: ScheduledTaskService) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const workspace = await resolveTrustedLocalWorkspace(context)
    if (!workspace.success) return workspace

    switch (toolName) {
      case 'scheduled_task_list':
        return this.list(workspace.workspacePath)
      case 'scheduled_task_get_runtime_status':
        return this.runtimeStatus(workspace.workspacePath)
      case 'scheduled_task_list_runs':
        return this.listRuns(
          workspace.workspacePath,
          parseScheduledTaskId(params.taskId),
          parseRunLimit(params.limit),
        )
      default:
        throw new Error(`未知定时任务工具: ${toolName}`)
    }
  }

  private async list(workspacePath: string): Promise<unknown> {
    const result = await this.service.list(workspacePath)
    if (!result.success) return serviceFailure(result.error)
    return {
      success: true,
      tasks: result.tasks.map(summarizeTask),
    }
  }

  private async runtimeStatus(workspacePath: string): Promise<unknown> {
    const result = await this.service.getWorkspaceRuntimeStatus(workspacePath)
    if (!result.success || !result.runtime) return serviceFailure(result.error)
    return { success: true, runtime: result.runtime }
  }

  private async listRuns(workspacePath: string, taskId: string, limit: number): Promise<unknown> {
    const result = await this.service.listRuns(workspacePath, taskId)
    if (!result.success) return serviceFailure(result.error)
    return {
      success: true,
      taskId,
      runs: result.runs.slice(0, limit).map(summarizeRun),
      limit,
      hasMore: result.runs.length > limit,
    }
  }
}

function summarizeTask(task: ScheduledTaskSnapshot) {
  return {
    taskId: task.definition.id,
    title: task.definition.title,
    revision: task.definition.revision,
    enabled: task.activation.enabled,
    nextRunAt: task.activation.nextRunAt,
    latestRun: task.latestRun ? summarizeRun(task.latestRun) : null,
  }
}

function summarizeRun(run: ScheduledTaskRun) {
  return {
    runId: run.id,
    taskId: run.taskId,
    taskRevision: run.taskRevision,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor,
    status: run.status,
    currentStep: run.currentStep.slice(0, 500),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    hasArtifact: Boolean(run.artifact),
    ...(run.error
      ? {
          error: {
            code: run.error.code,
            message: run.error.message.slice(0, 500),
            ...(run.error.recovery ? { recovery: run.error.recovery.slice(0, 500) } : {}),
          },
        }
      : {}),
  }
}

async function resolveTrustedLocalWorkspace(
  context?: ToolExecutionContext,
): Promise<
  | { success: true; workspacePath: string }
  | { success: false; error: { code: string; message: string } }
> {
  const workspace = context?.trustedWorkspace
  if (!workspace) return workspaceFailure('WORKSPACE_CONTEXT_MISSING', '缺少受信工作空间上下文')
  if (workspace.kind !== 'local') {
    return workspaceFailure(
      'LOCAL_WORKSPACE_REQUIRED',
      '当前 Agent 会话未绑定本地工作空间，Studio 定时任务查询不可用',
    )
  }
  if (!isAbsolute(workspace.rootPath) || !isAbsolute(workspace.workspaceKey)) {
    return workspaceFailure('WORKSPACE_CONTEXT_MISMATCH', '受信工作空间上下文不一致')
  }
  try {
    const normalizedRoot = resolve(workspace.rootPath)
    const [canonicalRoot, canonicalKey] = await Promise.all([
      realpath(normalizedRoot),
      realpath(resolve(workspace.workspaceKey)),
    ])
    if (canonicalRoot !== canonicalKey) {
      return workspaceFailure('WORKSPACE_CONTEXT_MISMATCH', '受信工作空间上下文不一致')
    }
    // ScheduledTaskService remains responsible for resolving and validating the workspace.
    // Keep the trusted path spelling here because macOS can canonicalize /var to /private/var.
    return { success: true, workspacePath: normalizedRoot }
  } catch {
    return workspaceFailure('WORKSPACE_UNAVAILABLE', '当前本地工作空间不可用')
  }
}

function workspaceFailure(code: string, message: string) {
  return { success: false as const, error: { code, message } }
}

function serviceFailure(error?: ScheduledTaskFailure) {
  return {
    success: false as const,
    error: error ?? {
      code: 'SCHEDULED_TASK_INVALID',
      message: '定时任务服务未返回可用结果',
    },
  }
}

function parseRunLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_RUN_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('limit 必须是整数')
  }
  if (value < 1 || value > MAX_RUN_LIMIT) {
    throw new Error(`limit 必须在 1 到 ${MAX_RUN_LIMIT} 之间`)
  }
  return value
}
