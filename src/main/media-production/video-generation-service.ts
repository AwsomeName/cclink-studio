import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseMediaProjectAsset } from '../../shared/media-production/media-project-schema'
import type {
  CreateMediaVideoTaskInput,
  MediaVideoProviderStatusResult,
  MediaVideoTask,
  MediaVideoTaskListResult,
  MediaVideoTaskResult,
  MediaVideoTaskStatus,
} from '../../shared/media-production/video-generation-types'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { MediaAssetService } from './media-asset-service'
import type { MediaProjectService } from './media-project-service'
import type { VideoGenerationProvider } from './providers/video-generation-provider'

const TASK_FILE = 'video-tasks.json'
const POLL_TIMEOUT_MS = 20 * 60_000
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

interface VideoGenerationDependencies {
  fetch: typeof fetch
  sleep: (milliseconds: number) => Promise<void>
  now: () => number
  pollIntervalMs: number
}

const DEFAULT_DEPENDENCIES: VideoGenerationDependencies = {
  fetch,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
  pollIntervalMs: 5_000,
}

export class VideoGenerationService {
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly activePolls = new Map<string, Promise<void>>()

  constructor(
    private readonly projectService: MediaProjectService,
    private readonly assetService: MediaAssetService,
    private readonly provider: VideoGenerationProvider,
    private readonly getUsageLedger: () => UsageLedgerService | null,
    private readonly dependencies: VideoGenerationDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  getProviders(): MediaVideoProviderStatusResult {
    return { success: true, providers: [this.provider.getStatus()] }
  }

  async createTask(input: CreateMediaVideoTaskInput): Promise<MediaVideoTaskResult> {
    const status = this.provider.getStatus()
    if (!status.configured) {
      return failure(
        'MEDIA_PROJECT_VIDEO_PROVIDER_UNAVAILABLE',
        status.reason || '即梦视频 Provider 未配置',
      )
    }
    const projectResult = await this.projectService.get(input.workspacePath, input.projectId)
    if (!projectResult.success) return projectResult
    if (projectResult.project.revision !== input.projectRevision) {
      return failure('MEDIA_PROJECT_REVISION_CONFLICT', '工程已更新，请基于最新分镜重新确认生成')
    }
    if (!projectResult.project.scenes.some((scene) => scene.id === input.sceneId)) {
      return failure('MEDIA_PROJECT_INVALID', '待生成的场景不存在')
    }
    try {
      const submitted = await this.provider.createTask({
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
      })
      const now = this.dependencies.now()
      const task: MediaVideoTask = {
        id: randomUUID(),
        workspacePath: projectResult.project.workspaceRef.path,
        projectId: input.projectId,
        projectRevision: input.projectRevision,
        sceneId: input.sceneId,
        provider: input.provider,
        providerTaskId: submitted.taskId,
        model: input.model,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        status: 'queued',
        progress: null,
        createdAt: now,
        updatedAt: now,
      }
      await this.upsertTask(task)
      this.startPolling(task)
      return { success: true, task }
    } catch (error) {
      return failure(
        'MEDIA_PROJECT_VIDEO_SUBMIT_FAILED',
        error instanceof Error ? error.message : '即梦视频任务提交失败',
        '检查权限、余额、审核提示或限流状态后单独重试当前场景',
      )
    }
  }

  async listTasks(workspacePath: string, projectId: string): Promise<MediaVideoTaskListResult> {
    try {
      const project = await this.projectService.get(workspacePath, projectId)
      if (!project.success) return { success: false, tasks: [], error: project.error }
      const tasks = await this.readTasks(project.project.workspaceRef.path, projectId)
      for (const task of tasks) {
        if (task.status === 'queued' || task.status === 'running') this.startPolling(task)
      }
      return { success: true, tasks: tasks.sort((left, right) => right.createdAt - left.createdAt) }
    } catch (error) {
      return {
        success: false,
        tasks: [],
        error: {
          code: 'MEDIA_PROJECT_STORE_INVALID',
          message: error instanceof Error ? error.message : '视频任务账本无法读取',
        },
      }
    }
  }

  async retryTask(workspacePath: string, taskId: string): Promise<MediaVideoTaskResult> {
    const projectsRoot = await this.resolveProjectFromTask(workspacePath, taskId)
    if (!projectsRoot) return failure('MEDIA_PROJECT_NOT_FOUND', '待重试的视频任务不存在')
    const { task } = projectsRoot
    return this.createTask({
      workspacePath,
      projectId: task.projectId,
      projectRevision: task.projectRevision,
      sceneId: task.sceneId,
      provider: task.provider,
      model: task.model,
      prompt: task.prompt,
      aspectRatio: task.aspectRatio,
      durationSeconds: task.durationSeconds,
    })
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => undefined)
  }

  private startPolling(task: MediaVideoTask): void {
    if (this.activePolls.has(task.id)) return
    const poll = this.pollUntilTerminal(task).finally(() => this.activePolls.delete(task.id))
    this.activePolls.set(task.id, poll)
  }

  private async pollUntilTerminal(initialTask: MediaVideoTask): Promise<void> {
    let task = initialTask
    const startedAt = this.dependencies.now()
    try {
      while (this.dependencies.now() - startedAt <= POLL_TIMEOUT_MS) {
        const snapshot = await this.provider.getTask(task.providerTaskId)
        task = {
          ...task,
          status: snapshot.status,
          progress: snapshot.progress,
          ...(snapshot.errorCode ? { errorCode: snapshot.errorCode } : {}),
          ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
          updatedAt: this.dependencies.now(),
        }
        if (snapshot.status === 'succeeded' && snapshot.resultUrl) {
          const content = await this.downloadResult(snapshot.resultUrl)
          const outputAsset = await this.assetService.storeGeneratedVideo({
            workspacePath: task.workspacePath,
            projectId: task.projectId,
            content,
            provider: task.provider,
            model: task.model,
            taskId: task.providerTaskId,
            prompt: task.prompt,
          })
          task = { ...task, outputAsset, updatedAt: this.dependencies.now() }
          await this.upsertTask(task)
          await this.recordUsage(task, 'video', 'succeeded')
          return
        }
        await this.upsertTask(task)
        if (isTerminal(task.status)) {
          await this.recordUsage(task, 'video', 'failed')
          return
        }
        await this.dependencies.sleep(this.dependencies.pollIntervalMs)
      }
      await this.upsertTask({
        ...task,
        status: 'unknown',
        errorCode: 'poll_timeout',
        errorMessage: '轮询超时，Provider 任务状态未知',
        updatedAt: this.dependencies.now(),
      })
    } catch (error) {
      await this.upsertTask({
        ...task,
        status: 'unknown',
        errorCode: 'poll_failed',
        errorMessage: error instanceof Error ? error.message : '查询或下载视频结果失败',
        updatedAt: this.dependencies.now(),
      })
    }
  }

  private async downloadResult(value: string): Promise<Buffer> {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !isTrustedVolcengineHost(url.hostname)) {
      throw new Error('即梦视频结果地址不受信任')
    }
    const response = await this.dependencies.fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`即梦视频结果下载失败 (${response.status})`)
    if (!response.body) throw new Error('即梦视频结果没有内容')
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      total += buffer.length
      if (total > MAX_VIDEO_BYTES) throw new Error('即梦视频结果超过 500 MB')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }

  private async upsertTask(task: MediaVideoTask): Promise<void> {
    await this.enqueue(async () => {
      const tasks = await this.readTasks(task.workspacePath, task.projectId)
      const index = tasks.findIndex((candidate) => candidate.id === task.id)
      if (index >= 0) tasks[index] = task
      else tasks.push(task)
      const path = await this.taskFile(task.workspacePath, task.projectId)
      const temporaryPath = `${path}.${process.pid}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf-8')
      await rename(temporaryPath, path)
    })
  }

  private async readTasks(workspacePath: string, projectId: string): Promise<MediaVideoTask[]> {
    const path = await this.taskFile(workspacePath, projectId)
    try {
      const value = JSON.parse(await readFile(path, 'utf-8'))
      if (!Array.isArray(value)) throw new Error('视频任务账本无效')
      return value.map(parseTask)
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  private async taskFile(workspacePath: string, projectId: string): Promise<string> {
    const workspace = await realpath(workspacePath)
    return join(workspace, '.cclink-studio', 'media-projects', projectId, TASK_FILE)
  }

  private async resolveProjectFromTask(
    workspacePath: string,
    taskId: string,
  ): Promise<{ task: MediaVideoTask } | null> {
    const projectIds = await this.projectService.list(workspacePath)
    if (!projectIds.success) return null
    for (const project of projectIds.projects) {
      const task = (await this.readTasks(workspacePath, project.id)).find(
        (item) => item.id === taskId,
      )
      if (task) return { task }
    }
    return null
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async recordUsage(
    task: MediaVideoTask,
    unit: 'video',
    status: 'succeeded' | 'failed',
  ): Promise<void> {
    await this.getUsageLedger()
      ?.record({
        conversationId: `media-project:${task.projectId}`,
        source: 'video-generation',
        provider: task.provider,
        model: task.model,
        quantity: 1,
        unit,
        estimated: false,
        status,
        taskId: task.providerTaskId,
      })
      .catch(() => undefined)
  }
}

function parseTask(value: unknown): MediaVideoTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('视频任务无效')
  const task = value as MediaVideoTask
  if (
    typeof task.id !== 'string' ||
    typeof task.projectId !== 'string' ||
    typeof task.sceneId !== 'string' ||
    typeof task.providerTaskId !== 'string' ||
    !isTaskStatus(task.status)
  ) {
    throw new Error('视频任务字段无效')
  }
  return task.outputAsset
    ? { ...task, outputAsset: parseMediaProjectAsset(task.outputAsset) }
    : task
}

function isTaskStatus(value: unknown): value is MediaVideoTaskStatus {
  return ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(
    String(value),
  )
}

function isTerminal(status: MediaVideoTaskStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'unknown'
}

function isTrustedVolcengineHost(hostname: string): boolean {
  return hostname.endsWith('.volces.com') || hostname.endsWith('.volcengine.com')
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function failure(
  code: Extract<MediaVideoTaskResult, { success: false }>['error']['code'],
  message: string,
  recovery?: string,
): MediaVideoTaskResult {
  return { success: false, error: { code, message, recovery } }
}
