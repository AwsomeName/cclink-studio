import {
  MAX_GENERATED_IMAGE_BYTES,
  normalizeImageMimeType,
  validateImageContent,
} from '../image-content'
import type {
  GeneratedImage,
  ImageAspectRatio,
  ImageGenerationProvider,
  ImageGenerationProviderStatus,
  ImageGenerationRequest,
  MeshyImageModel,
} from '../types'

const API_BASE_URL = 'https://api.meshy.ai'
const TEXT_TO_IMAGE_PATH = '/openapi/v1/text-to-image'
const DEFAULT_MODEL: MeshyImageModel = 'nano-banana'
const DEFAULT_ASPECT_RATIO: ImageAspectRatio = '16:9'
const DEFAULT_POLL_INTERVAL_MS = 3_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const FINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED'])
const MODELS = new Set<MeshyImageModel>([
  'nano-banana',
  'nano-banana-2',
  'nano-banana-pro',
  'gpt-image-2',
])
const STANDARD_ASPECT_RATIOS = new Set<ImageAspectRatio>(['1:1', '16:9', '9:16', '4:3', '3:4'])
const GPT_IMAGE_ASPECT_RATIOS = new Set<ImageAspectRatio>(['1:1', '3:2', '2:3'])
interface MeshyTextToImageTask {
  id: string
  ai_model: string
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
  progress?: number
  image_urls?: string[]
  consumed_credits?: number
  task_error?: { message?: string }
}

interface MeshyImageProviderDependencies {
  fetch: typeof fetch
  sleep: (milliseconds: number) => Promise<void>
  now: () => number
  pollIntervalMs: number
  timeoutMs: number
}

const DEFAULT_DEPENDENCIES: MeshyImageProviderDependencies = {
  fetch,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
}

export class MeshyImageProvider implements ImageGenerationProvider {
  readonly id = 'meshy' as const

  constructor(
    private readonly getApiKey: () => string,
    private readonly dependencies: MeshyImageProviderDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  getStatus(): ImageGenerationProviderStatus {
    const configured = this.getApiKey().trim().length > 0
    return {
      id: this.id,
      configured,
      models: Array.from(MODELS),
      ...(configured ? {} : { reason: '请先在设置中配置 Meshy API Key' }),
    }
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const prompt = request.prompt.trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    if (prompt.length > 4_000) throw new Error('图片提示词不能超过 4000 个字符')
    const model = request.model ?? DEFAULT_MODEL
    if (!MODELS.has(model as MeshyImageModel)) {
      throw new Error(`不支持的 Meshy 图片模型: ${model}`)
    }
    const aspectRatio = request.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const allowedRatios = model === 'gpt-image-2' ? GPT_IMAGE_ASPECT_RATIOS : STANDARD_ASPECT_RATIOS
    if (!allowedRatios.has(aspectRatio)) {
      throw new Error(`模型 ${model} 不支持画幅 ${aspectRatio}`)
    }

    const created = await this.request<{ result: string }>(TEXT_TO_IMAGE_PATH, {
      method: 'POST',
      body: {
        ai_model: model,
        prompt,
        aspect_ratio: aspectRatio,
      },
    })
    if (!created.result) throw new Error('Meshy 没有返回图片任务 ID')
    const task = await this.waitForTask(created.result)
    if (task.status !== 'SUCCEEDED') {
      const detail = task.task_error?.message ? `: ${task.task_error.message}` : ''
      throw new Error(`Meshy 图片生成失败 (${task.status})${detail}`)
    }
    const imageUrl = task.image_urls?.[0]
    if (!imageUrl) throw new Error('Meshy 图片任务成功，但没有返回图片地址')
    const downloaded = await this.downloadImage(imageUrl)
    return {
      provider: this.id,
      model: task.ai_model || model,
      taskId: task.id,
      content: downloaded.content,
      mimeType: downloaded.mimeType,
      ...(typeof task.consumed_credits === 'number'
        ? { consumedCredits: task.consumed_credits }
        : {}),
    }
  }

  private async waitForTask(taskId: string): Promise<MeshyTextToImageTask> {
    const startedAt = this.dependencies.now()
    while (this.dependencies.now() - startedAt <= this.dependencies.timeoutMs) {
      const task = await this.request<MeshyTextToImageTask>(
        `${TEXT_TO_IMAGE_PATH}/${encodeURIComponent(taskId)}`,
        { method: 'GET' },
      )
      if (FINAL_STATUSES.has(task.status)) return task
      await this.dependencies.sleep(this.dependencies.pollIntervalMs)
    }
    throw new Error(`等待 Meshy 图片任务超时: ${taskId}`)
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
  ): Promise<T> {
    const apiKey = this.getApiKey().trim()
    if (!apiKey) throw new Error('请先在设置中配置 Meshy API Key')
    const response = await this.dependencies.fetch(`${API_BASE_URL}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(
        `Meshy API 请求失败 (${response.status}): ${sanitizeProviderError(text || response.statusText)}`,
      )
    }
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  private async downloadImage(
    rawUrl: string,
  ): Promise<{ content: Buffer; mimeType: GeneratedImage['mimeType'] }> {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || !isMeshyHost(url.hostname)) {
      throw new Error('Meshy 返回了不受信任的图片下载地址')
    }
    const response = await this.dependencies.fetch(url, { redirect: 'error' })
    if (!response.ok) {
      throw new Error(`下载 Meshy 图片失败 (${response.status}): ${response.statusText}`)
    }
    const mimeType = normalizeImageMimeType(response.headers.get('content-type'))
    if (!mimeType) {
      throw new Error(
        `Meshy 返回了不支持的图片类型: ${response.headers.get('content-type') ?? '未知'}`,
      )
    }
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (declaredLength > MAX_GENERATED_IMAGE_BYTES) throw new Error('Meshy 图片超过 25MB 限制')
    const content = Buffer.from(await response.arrayBuffer())
    return { content, mimeType: validateImageContent(content, mimeType) }
  }
}

function isMeshyHost(hostname: string): boolean {
  return hostname === 'meshy.ai' || hostname.endsWith('.meshy.ai')
}

function sanitizeProviderError(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 500)
}
