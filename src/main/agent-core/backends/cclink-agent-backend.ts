import { request, type ClientRequest, type IncomingMessage } from 'node:http'
import type {
  AgentBackendStatus,
  AgentEventHandler,
  AgentSendOptions,
  IAgentBackend,
} from './types.js'

export interface CclinkAgentBackendOptions {
  baseUrl: string
  token: string
  runtimeId: string
  getWorkspacePath?: () => string
}

interface SseMessage {
  event: string
  data: unknown
}

interface RemoteRuntimeEvent {
  type?: string
  request_id?: string
  session_id?: string
  runtime_session_id?: string
  delta?: string
  text?: string
  final_text?: string
  state?: string
  message?: string
  code?: string
  done?: boolean
  ok?: boolean
  error?: { code?: string; message?: string }
}

/** HTTP/SSE adapter for the explicitly enabled experimental chatcc backend. */
export class CclinkAgentBackend implements IAgentBackend {
  readonly exactCancellationSupported = false
  private readonly options: CclinkAgentBackendOptions
  private eventHandler: AgentEventHandler | null = null
  private sessionId: string | null = null
  private activeRequest: ClientRequest | null = null
  private activeRequestDone: Promise<void> | null = null
  private destroyed = false

  constructor(options: CclinkAgentBackendOptions) {
    const url = new URL(options.baseUrl)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new Error('实验性 cclink-agent 只允许连接 Studio 启动的 127.0.0.1 HTTP 服务')
    }
    this.options = options
  }

  async sendMessage(message: string, options?: AgentSendOptions): Promise<void> {
    if (this.destroyed) throw new Error('cclink-agent 后端已销毁')
    if (this.activeRequest) throw new Error('cclink-agent 当前 Thread 已有活动请求')
    const requestId = options?.runId?.trim()
    if (!requestId) throw new Error('cclink-agent 请求缺少 Studio runId')
    const workspacePath =
      options?.workspacePath?.trim() || this.options.getWorkspacePath?.().trim() || ''
    if (!workspacePath) throw new Error('cclink-agent 请求缺少本地工作区')

    const done = this.runRequest({
      message,
      requestId,
      conversationId: options?.conversationId ?? 'agent-default',
      workspacePath,
    }).finally(() => {
      if (this.activeRequestDone === done) {
        this.activeRequest = null
        this.activeRequestDone = null
      }
    })
    this.activeRequestDone = done
    void done.catch((error) => {
      if (this.destroyed) return
      this.emit('error', {
        type: 'error',
        code: errorCode(error),
        message: errorMessage(error),
      })
    })
  }

  async abort(): Promise<void> {
    throw new Error(
      'cclink-agent HTTP/SSE 协议尚无按 request_id 精确取消接口；Studio 未把断开 SSE 伪装成已取消',
    )
  }

  getStatus(): AgentBackendStatus {
    return { connected: this.activeRequest !== null, sessionId: this.sessionId }
  }

  resetSession(): void {
    if (this.activeRequest) throw new Error('cclink-agent 响应中不能重置 Session')
    this.sessionId = null
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  setSessionId(sessionId: string | null): void {
    if (this.activeRequest) throw new Error('cclink-agent 响应中不能恢复 Session')
    this.sessionId = sessionId?.trim() || null
  }

  onEvent(handler: AgentEventHandler): void {
    this.eventHandler = handler
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    this.activeRequest?.destroy()
    await this.activeRequestDone?.catch(() => undefined)
    this.activeRequest = null
    this.activeRequestDone = null
    this.eventHandler = null
  }

  private async runRequest(input: {
    message: string
    requestId: string
    conversationId: string
    workspacePath: string
  }): Promise<void> {
    const body = JSON.stringify({
      token: this.options.token,
      request_id: input.requestId,
      session_id: input.conversationId,
      runtime: this.options.runtimeId,
      runtime_session_id: this.sessionId ?? '',
      workspace_path: input.workspacePath,
      workspace_restricted: true,
      permissions: { default_mode: 'confirm_every' },
      prompt: input.message,
    })
    const endpoint = new URL('/cclink-studio/v1/runtime/session', this.options.baseUrl)
    const response = await this.openRequest(endpoint, body)
    if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
      const failure = await readResponseBody(response)
      throw remoteHttpError(response.statusCode ?? 500, failure)
    }
    const contentType = String(response.headers['content-type'] ?? '')
    if (!contentType.includes('text/event-stream')) {
      response.resume()
      throw new Error(`cclink-agent 返回了非 SSE 响应: ${contentType || 'unknown'}`)
    }

    let terminal = false
    let assembledText = ''
    let sawDelta = false
    await consumeSse(response, (message) => {
      const event = toRemoteRuntimeEvent(message.data)
      this.captureSession(event.runtime_session_id)
      if (message.event === 'error' || event.type === 'error' || event.ok === false) {
        terminal = true
        throw new CclinkAgentProtocolError(
          event.error?.code || event.code || 'cclink_agent_remote_error',
          event.error?.message || event.message || 'cclink-agent Runtime 返回错误',
        )
      }
      if (message.event === 'done' || event.done === true) {
        terminal = true
        if (!this.sessionId) {
          throw new CclinkAgentProtocolError(
            'cclink_agent_session_id_missing',
            'cclink-agent 流已完成，但没有返回 runtime_session_id，无法安全续聊',
          )
        }
        this.emit('complete', {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: assembledText || event.final_text || '',
        })
        return
      }
      if (event.type === 'approval_request') {
        this.emit('stream', {
          protocol: 'studio-agent-event-v1',
          event: {
            type: 'notice',
            text: 'cclink-agent 请求了工具审批；实验 HTTP/SSE 协议尚未接入 Studio PermissionManager，本轮会保持等待。',
          },
        })
        return
      }
      if (
        event.type === 'thinking' &&
        event.state === 'completed' &&
        typeof event.final_text === 'string' &&
        event.final_text
      ) {
        const suffix = event.final_text.startsWith(assembledText)
          ? event.final_text.slice(assembledText.length)
          : assembledText
            ? ''
            : event.final_text
        if (suffix) {
          assembledText += suffix
          this.emitTextDelta(input.requestId, suffix)
        }
        return
      }
      if (event.type !== 'text') return
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (delta) {
        sawDelta = true
        assembledText += delta
        this.emitTextDelta(input.requestId, delta)
        return
      }
      const text = typeof event.text === 'string' ? event.text : ''
      if (!text) return
      if (sawDelta) {
        if (text.startsWith(assembledText)) {
          const suffix = text.slice(assembledText.length)
          if (suffix) {
            assembledText += suffix
            this.emitTextDelta(input.requestId, suffix)
          }
        }
        return
      }
      const suffix = text.startsWith(assembledText) ? text.slice(assembledText.length) : text
      if (!suffix) return
      assembledText += suffix
      this.emitTextDelta(input.requestId, suffix)
    })
    if (!terminal) {
      throw new CclinkAgentProtocolError(
        'cclink_agent_stream_incomplete',
        'cclink-agent SSE 连接已结束，但没有收到 done/error 终态',
      )
    }
  }

  private openRequest(endpoint: URL, body: string): Promise<IncomingMessage> {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        endpoint,
        {
          method: 'POST',
          headers: {
            accept: 'text/event-stream',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        resolve,
      )
      this.activeRequest = req
      req.once('error', reject)
      req.end(body)
    })
  }

  private captureSession(value: string | undefined): void {
    const sessionId = value?.trim()
    if (!sessionId || sessionId === this.sessionId) return
    this.sessionId = sessionId
    this.emit('system', { type: 'system', subtype: 'init', session_id: sessionId })
  }

  private emitTextDelta(messageId: string, text: string): void {
    this.emit('stream', {
      protocol: 'studio-agent-event-v1',
      event: { type: 'text-delta', messageId, text },
    })
  }

  private emit(type: 'stream' | 'complete' | 'error' | 'system', data: unknown): void {
    this.eventHandler?.(type, data)
  }
}

class CclinkAgentProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CclinkAgentProtocolError'
  }
}

export async function consumeSse(
  response: IncomingMessage,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  response.setEncoding('utf8')
  let buffer = ''
  for await (const chunk of response) {
    buffer += String(chunk).replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const parsed = parseSseBlock(block)
      if (parsed) onMessage(parsed)
      boundary = buffer.indexOf('\n\n')
    }
  }
  const trailing = parseSseBlock(buffer)
  if (trailing) onMessage(trailing)
}

function parseSseBlock(block: string): SseMessage | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim() || 'message'
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  const value = data.join('\n')
  try {
    return { event, data: JSON.parse(value) }
  } catch {
    throw new CclinkAgentProtocolError(
      'cclink_agent_invalid_sse_json',
      'cclink-agent 返回了无法解析的 SSE JSON',
    )
  }
}

function toRemoteRuntimeEvent(value: unknown): RemoteRuntimeEvent {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RemoteRuntimeEvent)
    : {}
}

async function readResponseBody(response: IncomingMessage): Promise<string> {
  response.setEncoding('utf8')
  let text = ''
  for await (const chunk of response) text = `${text}${String(chunk)}`.slice(-64_000)
  return text
}

function remoteHttpError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body) as RemoteRuntimeEvent
    return new CclinkAgentProtocolError(
      parsed.error?.code || `cclink_agent_http_${status}`,
      parsed.error?.message || `cclink-agent HTTP ${status}`,
    )
  } catch (error) {
    if (error instanceof CclinkAgentProtocolError) return error
    return new CclinkAgentProtocolError(
      `cclink_agent_http_${status}`,
      `cclink-agent HTTP ${status}`,
    )
  }
}

function errorCode(error: unknown): string {
  return error instanceof CclinkAgentProtocolError ? error.code : 'cclink_agent_transport_error'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
