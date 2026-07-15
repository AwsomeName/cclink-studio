import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import type { AppSettings } from '../settings/types'
import type {
  MeshyCreatePreviewOptions,
  MeshyCreateRefineOptions,
  MeshyFormat,
  MeshyGenerateAndSaveOptions,
  MeshyGenerateAndSaveResult,
  MeshySaveAssetOptions,
  MeshySavedAsset,
  MeshyTask,
} from './types'

const MESHY_API_BASE_URL = 'https://api.meshy.ai/openapi/v2'
const TEXT_TO_3D_PATH = '/text-to-3d'
const DEFAULT_FORMAT: MeshyFormat = 'glb'
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const FINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'EXPIRED'])
const SUPPORTED_FORMATS = new Set<MeshyFormat>(['glb', 'obj', 'fbx', 'stl', 'usdz', '3mf'])

type MeshySettings = Pick<AppSettings, 'meshyApiKey' | 'lastWorkspacePath'>

export class MeshyService {
  constructor(private readonly getSettings: () => MeshySettings) {}

  async createPreview(options: MeshyCreatePreviewOptions): Promise<{ taskId: string }> {
    this.validatePrompt(options.prompt)
    const body = this.withDefinedValues({
      mode: 'preview',
      prompt: options.prompt,
      model_type: options.modelType,
      ai_model: options.aiModel,
      should_remesh: options.shouldRemesh,
      topology: options.topology,
      target_polycount: options.targetPolycount,
      decimation_mode: options.decimationMode,
      pose_mode: options.poseMode,
      target_formats: options.targetFormats,
      moderation: options.moderation,
      alpha_thumbnail: options.alphaThumbnail,
      auto_size: options.autoSize,
      origin_at: options.originAt,
    })
    const result = await this.request<{ result: string }>(TEXT_TO_3D_PATH, {
      method: 'POST',
      body,
    })
    return { taskId: result.result }
  }

  async createRefine(options: MeshyCreateRefineOptions): Promise<{ taskId: string }> {
    if (!options.previewTaskId) {
      throw new Error('缺少 previewTaskId')
    }
    if (options.texturePrompt) {
      this.validatePrompt(options.texturePrompt, 'texturePrompt')
    }
    const body = this.withDefinedValues({
      mode: 'refine',
      preview_task_id: options.previewTaskId,
      texture_prompt: options.texturePrompt,
      enable_pbr: options.enablePbr,
      hd_texture: options.hdTexture,
      ai_model: options.aiModel,
      moderation: options.moderation,
      remove_lighting: options.removeLighting,
      target_formats: options.targetFormats,
      alpha_thumbnail: options.alphaThumbnail,
      auto_size: options.autoSize,
      origin_at: options.originAt,
    })
    const result = await this.request<{ result: string }>(TEXT_TO_3D_PATH, {
      method: 'POST',
      body,
    })
    return { taskId: result.result }
  }

  async getTask(taskId: string): Promise<MeshyTask> {
    if (!taskId) {
      throw new Error('缺少 taskId')
    }
    return this.request<MeshyTask>(`${TEXT_TO_3D_PATH}/${encodeURIComponent(taskId)}`, {
      method: 'GET',
    })
  }

  async waitForTask(taskId: string, options?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<MeshyTask> {
    const pollIntervalMs = this.normalizeDuration(
      options?.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      1_000,
      60_000,
    )
    const timeoutMs = this.normalizeDuration(options?.timeoutMs, DEFAULT_TIMEOUT_MS, 30_000, 20 * 60_000)
    const startedAt = Date.now()

    while (Date.now() - startedAt <= timeoutMs) {
      const task = await this.getTask(taskId)
      if (FINAL_STATUSES.has(task.status)) {
        return task
      }
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, pollIntervalMs))
    }

    throw new Error(`等待 Meshy 任务超时: ${taskId}`)
  }

  async saveAsset(options: MeshySaveAssetOptions): Promise<MeshySavedAsset> {
    const format = this.normalizeFormat(options.format)
    const task = await this.getTask(options.taskId)
    if (task.status !== 'SUCCEEDED') {
      throw new Error(`Meshy 任务尚未成功: ${task.status}`)
    }

    const modelUrl = task.model_urls?.[format]
    if (!modelUrl) {
      throw new Error(`任务结果中没有 ${format} 模型地址`)
    }

    const outputDir = this.resolveOutputDir(options.outputDir)
    const baseName = this.resolveBaseName(options.fileName, task)
    const filePath = join(outputDir, `${baseName}.${format}`)
    const modelBuffer = await this.download(modelUrl)
    await this.writeBinaryFile(filePath, modelBuffer)

    let metadataPath: string | undefined
    if (options.includeMetadata !== false) {
      metadataPath = join(outputDir, `${baseName}.meshy.json`)
      await this.writeJsonFile(metadataPath, {
        savedAt: new Date().toISOString(),
        format,
        modelPath: filePath,
        task,
      })
    }

    let thumbnailPath: string | undefined
    if (options.includeThumbnail !== false && task.thumbnail_url) {
      const thumbnailBuffer = await this.download(task.thumbnail_url)
      thumbnailPath = join(outputDir, `${baseName}.thumbnail.png`)
      await this.writeBinaryFile(thumbnailPath, thumbnailBuffer)
    }

    return {
      taskId: task.id,
      format,
      filePath,
      metadataPath,
      thumbnailPath,
      bytes: modelBuffer.byteLength,
      task,
    }
  }

  async generateAndSave(options: MeshyGenerateAndSaveOptions): Promise<MeshyGenerateAndSaveResult> {
    const format = this.normalizeFormat(options.format)
    const previewResult = await this.createPreview({
      ...options,
      targetFormats: [format],
    })
    const previewTask = await this.waitForTask(previewResult.taskId, options)
    if (previewTask.status !== 'SUCCEEDED') {
      throw new Error(this.formatTaskFailure('Meshy preview 失败', previewTask))
    }

    if (options.refine === false) {
      const savedAsset = await this.saveAsset({
        taskId: previewTask.id,
        format,
        outputDir: options.outputDir,
        fileName: options.fileName,
      })
      return { previewTask, savedAsset }
    }

    const refineResult = await this.createRefine({
      previewTaskId: previewTask.id,
      texturePrompt: options.texturePrompt,
      enablePbr: options.enablePbr,
      hdTexture: options.hdTexture,
      aiModel: options.aiModel,
      moderation: options.moderation,
      targetFormats: [format],
      autoSize: options.autoSize,
      originAt: options.originAt,
    })
    const refineTask = await this.waitForTask(refineResult.taskId, options)
    if (refineTask.status !== 'SUCCEEDED') {
      throw new Error(this.formatTaskFailure('Meshy refine 失败', refineTask))
    }

    const savedAsset = await this.saveAsset({
      taskId: refineTask.id,
      format,
      outputDir: options.outputDir,
      fileName: options.fileName,
    })
    return { previewTask, refineTask, savedAsset }
  }

  private async request<T>(path: string, options: { method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
    const apiKey = this.getApiKey()
    const response = await fetch(`${MESHY_API_BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Meshy API 请求失败 (${response.status}): ${text || response.statusText}`)
    }
    if (!text) {
      return {} as T
    }
    return JSON.parse(text) as T
  }

  private async download(url: string): Promise<Buffer> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`下载 Meshy 文件失败 (${response.status}): ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  private getApiKey(): string {
    const apiKey = this.getSettings().meshyApiKey?.trim()
    if (!apiKey) {
      throw new Error('请先在设置中配置 Meshy API Key')
    }
    return apiKey
  }

  private validatePrompt(prompt: string, fieldName = 'prompt'): void {
    if (!prompt?.trim()) {
      throw new Error(`缺少 ${fieldName}`)
    }
    if (prompt.length > 600) {
      throw new Error(`${fieldName} 不能超过 600 个字符`)
    }
  }

  private withDefinedValues(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  }

  private normalizeFormat(format?: MeshyFormat): MeshyFormat {
    const value = format ?? DEFAULT_FORMAT
    if (!SUPPORTED_FORMATS.has(value)) {
      throw new Error(`不支持的 Meshy 模型格式: ${value}`)
    }
    return value
  }

  private normalizeDuration(value: number | undefined, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback
    }
    return Math.min(Math.max(value, min), max)
  }

  private resolveOutputDir(outputDir?: string): string {
    const workspacePath = this.getSettings().lastWorkspacePath
    const candidate = outputDir?.trim()
      || (workspacePath ? join(workspacePath, 'assets', 'meshy') : join(app.getPath('desktop'), 'CCLink Studio Meshy Assets'))
    return this.validateWritablePath(candidate)
  }

  private resolveBaseName(fileName: string | undefined, task: MeshyTask): string {
    const raw = fileName?.trim() || task.prompt || task.id
    const safe = raw
      .replace(extname(raw), '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
    return safe || task.id
  }

  private validateWritablePath(targetPath: string): string {
    const resolved = resolve(targetPath)
    const home = app.getPath('home')
    const allowedRoots = [home, app.getPath('desktop'), app.getPath('documents'), app.getPath('downloads')]
    const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(root + sep))
    if (!isAllowed) {
      throw new Error(`路径不在允许范围内: ${resolved}`)
    }
    return resolved
  }

  private async writeBinaryFile(filePath: string, content: Buffer): Promise<void> {
    const safePath = this.validateWritablePath(filePath)
    await mkdir(dirname(safePath), { recursive: true })
    await writeFile(safePath, content)
  }

  private async writeJsonFile(filePath: string, content: unknown): Promise<void> {
    const safePath = this.validateWritablePath(filePath)
    await mkdir(dirname(safePath), { recursive: true })
    await writeFile(safePath, JSON.stringify(content, null, 2), 'utf-8')
  }

  private formatTaskFailure(prefix: string, task: MeshyTask): string {
    const message = task.task_error?.message ? `: ${task.task_error.message}` : ''
    return `${prefix} (${task.status})${message}`
  }
}
