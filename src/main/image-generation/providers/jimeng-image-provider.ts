import { MAX_GENERATED_IMAGE_BYTES, validateImageContent } from '../image-content'
import type {
  GeneratedImage,
  ImageAspectRatio,
  ImageGenerationProvider,
  ImageGenerationProviderStatus,
  ImageGenerationRequest,
  JimengImageModel,
} from '../types'
import { signVolcengineRequest } from './volcengine-signer'

const API_URL = 'https://visual.volcengineapi.com/'
const API_VERSION = '2022-08-31'
const REGION = 'cn-north-1'
const SERVICE = 'cv'
const SUBMIT_ACTION = 'CVSync2AsyncSubmitTask'
const RESULT_ACTION = 'CVSync2AsyncGetResult'
const REQUEST_KEY = 't2i_v40_jimeng'
const DEFAULT_MODEL: JimengImageModel = 'jimeng-4.0'
const DEFAULT_ASPECT_RATIO: ImageAspectRatio = '16:9'
const DEFAULT_POLL_INTERVAL_MS = 3_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MODELS = new Set<JimengImageModel>([DEFAULT_MODEL])
const TERMINAL_FAILURE_STATUSES = new Set(['not_found', 'expired'])
const DIMENSIONS: Record<ImageAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '16:9': { width: 2560, height: 1440 },
  '9:16': { width: 1440, height: 2560 },
  '4:3': { width: 2304, height: 1728 },
  '3:4': { width: 1728, height: 2304 },
  '3:2': { width: 2496, height: 1664 },
  '2:3': { width: 1664, height: 2496 },
}

export interface JimengCredentials {
  accessKeyId: string
  secretAccessKey: string
}

interface JimengApiResponse {
  code: number
  message?: string
  request_id?: string
  data?: {
    task_id?: string
    status?: string
    binary_data_base64?: string[] | null
  } | null
}

interface JimengImageProviderDependencies {
  fetch: typeof fetch
  sleep: (milliseconds: number) => Promise<void>
  now: () => number
  currentDate: () => Date
  pollIntervalMs: number
  timeoutMs: number
}

const DEFAULT_DEPENDENCIES: JimengImageProviderDependencies = {
  fetch,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
  currentDate: () => new Date(),
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
}

export class JimengImageProvider implements ImageGenerationProvider {
  readonly id = 'jimeng' as const

  constructor(
    private readonly getCredentials: () => JimengCredentials,
    private readonly dependencies: JimengImageProviderDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  getStatus(): ImageGenerationProviderStatus {
    const credentials = this.getCredentials()
    const configured =
      credentials.accessKeyId.trim().length > 0 && credentials.secretAccessKey.trim().length > 0
    return {
      id: this.id,
      configured,
      models: Array.from(MODELS),
      ...(configured ? {} : { reason: '请先在设置中配置即梦 Access Key ID 和 Secret Access Key' }),
    }
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const prompt = request.prompt.trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    if (prompt.length > 800) throw new Error('即梦图片提示词不能超过 800 个字符')
    const model = request.model ?? DEFAULT_MODEL
    if (!MODELS.has(model as JimengImageModel)) {
      throw new Error(`不支持的即梦图片模型: ${model}`)
    }
    const aspectRatio = request.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const dimensions = DIMENSIONS[aspectRatio]
    const submitted = await this.request(SUBMIT_ACTION, {
      req_key: REQUEST_KEY,
      prompt,
      force_single: true,
      width: dimensions.width,
      height: dimensions.height,
    })
    const taskId = submitted.data?.task_id
    if (!taskId) throw new Error('即梦没有返回图片任务 ID')
    const result = await this.waitForTask(taskId)
    const encoded = result.data?.binary_data_base64?.[0]
    if (!encoded) throw new Error('即梦图片任务成功，但没有返回图片内容')
    const content = decodeImageBase64(encoded)
    return {
      provider: this.id,
      model,
      taskId,
      content,
      mimeType: validateImageContent(content),
    }
  }

  private async waitForTask(taskId: string): Promise<JimengApiResponse> {
    const startedAt = this.dependencies.now()
    while (this.dependencies.now() - startedAt <= this.dependencies.timeoutMs) {
      const result = await this.request(RESULT_ACTION, {
        req_key: REQUEST_KEY,
        task_id: taskId,
        req_json: JSON.stringify({ return_url: false }),
      })
      const status = result.data?.status
      if (status === 'done') return result
      if (status && TERMINAL_FAILURE_STATUSES.has(status)) {
        throw new Error(`即梦图片任务不可用 (${status}): ${taskId}`)
      }
      await this.dependencies.sleep(this.dependencies.pollIntervalMs)
    }
    throw new Error(`等待即梦图片任务超时: ${taskId}`)
  }

  private async request(action: string, body: Record<string, unknown>): Promise<JimengApiResponse> {
    const credentials = this.getCredentials()
    const accessKeyId = credentials.accessKeyId.trim()
    const secretAccessKey = credentials.secretAccessKey.trim()
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('请先在设置中配置即梦 Access Key ID 和 Secret Access Key')
    }
    const url = new URL(API_URL)
    url.searchParams.set('Action', action)
    url.searchParams.set('Version', API_VERSION)
    const serializedBody = JSON.stringify(body)
    const signed = signVolcengineRequest({
      accessKeyId,
      secretAccessKey,
      method: 'POST',
      url,
      body: serializedBody,
      region: REGION,
      service: SERVICE,
      now: this.dependencies.currentDate(),
    })
    const response = await this.dependencies.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: signed.authorization,
        'Content-Type': 'application/json',
        'X-Content-Sha256': signed.xContentSha256,
        'X-Date': signed.xDate,
      },
      body: serializedBody,
      redirect: 'error',
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(
        `即梦 API 请求失败 (${response.status}): ${sanitizeProviderError(text || response.statusText)}`,
      )
    }
    let parsed: JimengApiResponse
    try {
      parsed = JSON.parse(text) as JimengApiResponse
    } catch {
      throw new Error('即梦 API 返回了无法解析的响应')
    }
    if (parsed.code !== 10_000) {
      const requestId = parsed.request_id ? `, requestId=${parsed.request_id}` : ''
      throw new Error(
        `即梦 API 返回错误 (${parsed.code}${requestId}): ${sanitizeProviderError(parsed.message ?? '未知错误')}`,
      )
    }
    return parsed
  }
}

function decodeImageBase64(value: string): Buffer {
  const encoded = value.trim()
  if (
    !encoded ||
    encoded.length > Math.ceil((MAX_GENERATED_IMAGE_BYTES * 4) / 3) + 4 ||
    encoded.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error('即梦返回了无效或过大的图片内容')
  }
  return Buffer.from(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='), 'base64')
}

function sanitizeProviderError(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 500)
}
