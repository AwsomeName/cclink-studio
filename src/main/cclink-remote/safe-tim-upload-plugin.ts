import XMLHttpRequest from 'xhr2'

interface TimUploadOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  resources: unknown
  downloadUrl?: string
  timeout?: number
  onProgress?(progress: { total: number; loaded: number; percent: number }): void
}

interface TimUploadResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
  data?: { location: string }
}

type TimUploadCallback = (
  error: { code: number; message: string } | null,
  response: TimUploadResponse,
) => void

type UploadRequest = InstanceType<typeof XMLHttpRequest>

export const TIM_UPLOAD_ABORT_SIGNAL = Symbol('cclink.tim-upload.abort-signal')

type UploadResource = {
  [TIM_UPLOAD_ABORT_SIGNAL]?: AbortSignal
}

/**
 * Minimal Tencent Chat upload-plugin contract for Electron's main process.
 * Unlike the vendor Web plugin, it never prints signed COS URLs or response payloads.
 */
export class SafeTimUploadPlugin {
  constructor(private readonly createRequest: () => UploadRequest = () => new XMLHttpRequest()) {}

  static getVersion(): string {
    return 'cclink-safe-1'
  }

  uploadFile(options: TimUploadOptions, callback: TimUploadCallback): UploadRequest | null {
    let uploadUrl: URL
    let downloadUrl: URL
    try {
      uploadUrl = new URL(options.url)
      downloadUrl = new URL(options.downloadUrl ?? '')
      if (uploadUrl.protocol !== 'https:' || downloadUrl.protocol !== 'https:') {
        throw new Error('图片上传地址必须使用 HTTPS')
      }
    } catch (error) {
      callback(
        { code: 0, message: error instanceof Error ? error.message : '图片上传地址无效' },
        { statusCode: 0, statusMessage: '', headers: {} },
      )
      return null
    }

    const request = this.createRequest()
    let settled = false
    const signal = readAbortSignal(options.resources)
    const abortRequest = (): void => request.abort()
    const settle: TimUploadCallback = (error, response) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abortRequest)
      callback(error, response)
    }
    request.open((options.method || 'PUT').toUpperCase(), uploadUrl.toString(), true)
    request.responseType = 'text'
    request.timeout = Math.min(Math.max(options.timeout ?? 300_000, 1_000), 300_000)
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue
      request.setRequestHeader(name, value)
    }
    request.upload.onprogress = (event) => {
      const total = event.total || 0
      const loaded = event.loaded || 0
      options.onProgress?.({ total, loaded, percent: total > 0 ? Math.min(1, loaded / total) : 0 })
    }
    request.onload = () => {
      const response = uploadResponse(request, downloadUrl.toString())
      if (request.status >= 200 && request.status < 300) {
        settle(null, response)
      } else {
        settle(
          { code: request.status, message: `图片上传失败（HTTP ${request.status}）` },
          response,
        )
      }
    }
    request.onerror = () => {
      settle({ code: request.status || 0, message: '图片上传网络错误' }, uploadResponse(request))
    }
    request.ontimeout = () => {
      settle({ code: 0, message: '图片上传超时' }, uploadResponse(request))
    }
    request.onabort = () => {
      settle({ code: 0, message: '图片上传已取消' }, uploadResponse(request))
    }
    if (signal?.aborted) {
      request.abort()
      settle({ code: 0, message: '图片上传已取消' }, uploadResponse(request))
      return request
    }
    signal?.addEventListener('abort', abortRequest, { once: true })
    request.send(options.resources as never)
    return request
  }
}

function readAbortSignal(resource: unknown): AbortSignal | undefined {
  if (!resource || (typeof resource !== 'object' && typeof resource !== 'function'))
    return undefined
  return (resource as UploadResource)[TIM_UPLOAD_ABORT_SIGNAL]
}

const FORBIDDEN_HEADERS = new Set(['content-length', 'user-agent', 'origin', 'host', 'cookie'])

function uploadResponse(request: UploadRequest, location?: string): TimUploadResponse {
  return {
    statusCode: request.status || 0,
    statusMessage: request.statusText || '',
    headers: responseHeaders(request.getAllResponseHeaders()),
    ...(location ? { data: { location } } : {}),
  }
}

function responseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of raw.trim().split(/\r?\n/u)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  return headers
}
