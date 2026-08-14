import type { JimengCredentials } from '../../image-generation/providers/jimeng-image-provider'
import { signVolcengineRequest } from '../../image-generation/providers/volcengine-signer'
import type {
  VideoGenerationProvider,
  VideoProviderCreateInput,
  VideoProviderTaskSnapshot,
} from './video-generation-provider'

const API_URL = 'https://visual.volcengineapi.com/'
const API_VERSION = '2024-06-06'
const REGION = 'cn-north-1'
const SERVICE = 'cv'
const SUBMIT_ACTION = 'JimengTI2VV30PROSubmitTask'
const RESULT_ACTION = 'JimengTI2VV30PROGetResult'
const REQUEST_KEY = 'jimeng_ti2v_v30_pro'

interface JimengVideoResponse {
  code: number
  message?: string
  request_id?: string
  data?: {
    task_id?: string
    status?: string
    video_url?: string
  } | null
}

interface JimengVideoDependencies {
  fetch: typeof fetch
  now: () => Date
}

const DEFAULT_DEPENDENCIES: JimengVideoDependencies = { fetch, now: () => new Date() }

export class JimengVideoProvider implements VideoGenerationProvider {
  readonly id = 'volcengine-jimeng-video' as const

  constructor(
    private readonly getCredentials: () => JimengCredentials,
    private readonly dependencies: JimengVideoDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  getStatus() {
    const credentials = this.getCredentials()
    const configured = Boolean(credentials.accessKeyId.trim() && credentials.secretAccessKey.trim())
    return {
      id: this.id,
      configured,
      models: ['jimeng-video-3.0-pro' as const],
      textToVideo: true,
      imageToVideo: false,
      durations: [5, 10] as Array<5 | 10>,
      aspectRatios: ['16:9', '9:16', '1:1'] as Array<'16:9' | '9:16' | '1:1'>,
      supportsCancel: false,
      costEstimate: null,
      ...(configured ? {} : { reason: '请先配置即梦 Access Key ID 和 Secret Access Key' }),
    }
  }

  async createTask(input: VideoProviderCreateInput): Promise<{ taskId: string }> {
    const response = await this.request(SUBMIT_ACTION, {
      req_key: REQUEST_KEY,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      frames: input.durationSeconds * 24 + 1,
      seed: -1,
    })
    const taskId = response.data?.task_id
    if (!taskId) throw new Error('即梦视频 API 没有返回任务 ID')
    return { taskId }
  }

  async getTask(taskId: string): Promise<VideoProviderTaskSnapshot> {
    const response = await this.request(RESULT_ACTION, { req_key: REQUEST_KEY, task_id: taskId })
    const status = response.data?.status
    if (status === 'in_queue') return { status: 'queued', progress: null }
    if (status === 'generating') return { status: 'running', progress: null }
    if (status === 'done' && response.data?.video_url) {
      return { status: 'succeeded', progress: 1, resultUrl: response.data.video_url }
    }
    if (status === 'not_found' || status === 'expired') {
      return {
        status: 'unknown',
        progress: null,
        errorCode: status,
        errorMessage: status === 'expired' ? '即梦任务已过期' : '即梦任务不存在',
      }
    }
    return { status: 'running', progress: null }
  }

  private async request(
    action: string,
    body: Record<string, unknown>,
  ): Promise<JimengVideoResponse> {
    const credentials = this.getCredentials()
    const accessKeyId = credentials.accessKeyId.trim()
    const secretAccessKey = credentials.secretAccessKey.trim()
    if (!accessKeyId || !secretAccessKey) throw new Error('即梦视频 AK/SK 未配置')
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
      now: this.dependencies.now(),
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
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let parsed: JimengVideoResponse
    try {
      parsed = JSON.parse(text) as JimengVideoResponse
    } catch {
      throw new Error(`即梦视频 API 返回无法解析的响应 (${response.status})`)
    }
    if (!response.ok || parsed.code !== 10_000) {
      throw providerError(parsed.code, parsed.message, parsed.request_id, response.status)
    }
    return parsed
  }
}

function providerError(
  code: number,
  message: string | undefined,
  requestId: string | undefined,
  httpStatus: number,
): Error {
  const category = [50411, 50412, 50413, 50511, 50512, 50516, 50518, 50519].includes(code)
    ? '内容审核拒绝'
    : code === 50429 || code === 50430 || httpStatus === 429
      ? '并发或频率受限'
      : /balance|credit|quota|余额|欠费/i.test(message ?? '')
        ? '余额或额度不足'
        : 'Provider 请求失败'
  return new Error(
    `${category} (${code || httpStatus}${requestId ? `, requestId=${requestId}` : ''}): ${(message || '未知错误').replace(/\s+/g, ' ').slice(0, 300)}`,
  )
}
