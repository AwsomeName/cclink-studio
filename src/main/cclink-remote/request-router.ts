import { randomUUID } from 'node:crypto'
import type { CclinkMessageType, CclinkProtocolMessage } from '../../shared/cclink'
import { isCclinkProtocolCompatible } from '../../shared/cclink'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'

export interface CclinkTransportEvent {
  serverId: string
  message: CclinkProtocolMessage
}
export interface CclinkTransport {
  sendMessage(serverId: string, message: CclinkProtocolMessage): Promise<void>
  onMessage(listener: (event: CclinkTransportEvent) => void): () => void
}

interface PendingRequest {
  serverId: string
  expectedTypes: Set<CclinkMessageType>
  timer: NodeJS.Timeout
  resolve(message: CclinkProtocolMessage): void
  reject(error: Error): void
}

export class CclinkRequestError extends Error {
  constructor(
    message: string,
    readonly remoteError: RemoteError,
  ) {
    super(message)
    this.name = 'CclinkRequestError'
  }
}

export class CclinkRequestRouter {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly protocolListeners = new Set<(event: CclinkTransportEvent) => void>()
  private transport: CclinkTransport | null = null
  private unsubscribe: (() => void) | null = null

  attach(transport: CclinkTransport): void {
    this.detach()
    this.transport = transport
    this.unsubscribe = transport.onMessage((event) => this.handleMessage(event))
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.transport = null
    for (const requestId of [...this.pending.keys()]) {
      this.reject(
        requestId,
        requestError(
          'transport',
          REMOTE_ERROR_CODE.TRANSPORT_UNAVAILABLE,
          'CCLink 实时连接已断开',
          true,
        ),
      )
    }
  }

  onProtocolEvent(listener: (event: CclinkTransportEvent) => void): () => void {
    this.protocolListeners.add(listener)
    return () => this.protocolListeners.delete(listener)
  }

  async send(serverId: string, message: CclinkProtocolMessage): Promise<void> {
    if (!this.transport) {
      throw requestError(
        'transport',
        REMOTE_ERROR_CODE.TRANSPORT_UNAVAILABLE,
        'CCLink 实时连接尚未建立',
        true,
      )
    }
    await this.transport.sendMessage(serverId, message)
  }

  request(
    serverId: string,
    message: CclinkProtocolMessage,
    expectedTypes: CclinkMessageType[],
    timeoutMs = 15_000,
  ): Promise<CclinkProtocolMessage> {
    if (!this.transport) {
      return Promise.reject(
        requestError(
          'transport',
          REMOTE_ERROR_CODE.TRANSPORT_UNAVAILABLE,
          'CCLink 实时连接尚未建立',
          true,
        ),
      )
    }
    const requestId = message.request_id || randomUUID()
    const outbound = { ...message, request_id: requestId, trace_id: message.trace_id || requestId }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          requestError(
            'transport',
            REMOTE_ERROR_CODE.REQUEST_TIMEOUT,
            '等待远程设备响应超时',
            true,
          ),
        )
      }, timeoutMs)
      this.pending.set(requestId, {
        serverId,
        expectedTypes: new Set(expectedTypes),
        timer,
        resolve,
        reject,
      })
      void this.transport!.sendMessage(serverId, outbound).catch((error: unknown) => {
        this.reject(
          requestId,
          requestError(
            'transport',
            REMOTE_ERROR_CODE.TRANSPORT_SEND_FAILED,
            error instanceof Error ? error.message : 'CCLink 消息发送失败',
            true,
          ),
        )
      })
    })
  }

  cancel(requestId: string): boolean {
    if (!this.pending.has(requestId)) return false
    this.reject(
      requestId,
      requestError('transport', REMOTE_ERROR_CODE.REQUEST_CANCELLED, '远程请求已取消', false),
    )
    return true
  }

  private handleMessage(event: CclinkTransportEvent): void {
    const requestId = event.message.request_id
    if (!isCclinkProtocolCompatible(event.message)) {
      if (requestId) {
        this.reject(
          requestId,
          requestError(
            'remote-agent',
            REMOTE_ERROR_CODE.PROTOCOL_INCOMPATIBLE,
            '远程 Agent 协议版本不兼容',
            false,
          ),
        )
      }
      return
    }
    for (const listener of this.protocolListeners) listener(event)
    if (!requestId) return
    const pending = this.pending.get(requestId)
    if (!pending || pending.serverId !== event.serverId) return
    if (event.message.cc_type === 'error') {
      const response = event.message as { message?: string; code?: string; retryable?: boolean }
      this.reject(
        requestId,
        requestError(
          'remote-agent',
          response.code || 'REMOTE_AGENT_ERROR',
          response.message || '远程 Agent 返回错误',
          response.retryable !== false,
        ),
      )
      return
    }
    if (!pending.expectedTypes.has(event.message.cc_type)) {
      this.reject(
        requestId,
        requestError(
          'remote-agent',
          REMOTE_ERROR_CODE.UNEXPECTED_RESPONSE,
          `收到非预期响应：${event.message.cc_type}`,
          true,
        ),
      )
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.resolve(event.message)
  }

  private reject(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.reject(error)
  }
}

function requestError(
  layer: RemoteError['layer'],
  code: string,
  message: string,
  retryable: boolean,
): CclinkRequestError {
  return new CclinkRequestError(message, { layer, code, message, retryable })
}
