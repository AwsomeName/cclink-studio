import { createHash } from 'node:crypto'
import type {
  CclinkProtocolMessage,
  CclinkTerminalPtyErrorMessage,
  CclinkTerminalPtyExitMessage,
  CclinkTerminalPtyOpenResponseMessage,
  CclinkTerminalPtyOutputMessage,
  CclinkTerminalPtyResponseMessage,
  CclinkTerminalPtyStateMessage,
} from '../../shared/cclink'
import { createCclinkEnvelope } from '../../shared/cclink'
import type { TerminalExecutionErrorInfo, TerminalExecutionEvent } from '../../shared/terminal'
import type { CclinkRemoteService } from '../cclink-remote/cclink-remote-service'
import type { CclinkRequestRouter } from '../cclink-remote/request-router'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

interface RemotePtySession {
  localSessionId: string
  terminalId: string
  traceId: string
  serverId: string
  workspaceId: string
  workspacePath: string
  inputSeq: number
  lastTerminalSeq: number
  keepaliveTimer: NodeJS.Timeout | null
  attachPromise: Promise<void> | null
  attachRetryTimer: NodeJS.Timeout | null
  attachAttempts: number
  replayGapNotified: boolean
}

export class CclinkTerminalExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend = 'remote-shell' as const
  private readonly sessions = new Map<string, RemotePtySession>()
  private readonly byTerminalId = new Map<string, RemotePtySession>()
  private readonly listeners = new Set<TerminalExecutionEventListener>()
  private realtimeOnline: boolean

  constructor(
    private readonly service: CclinkRemoteService,
    private readonly client: CclinkRequestRouter,
  ) {
    this.realtimeOnline = service.getRealtimeStatus().state === 'online'
    client.onProtocolEvent((event) => this.handleEvent(event.serverId, event.message))
    service.onStatus((status) => this.handleConnectionStatus(status.state === 'online'))
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    const ref = input.runtime.workspaceRef
    if (
      input.runtime.location !== 'remote' ||
      input.runtime.transport !== 'cclink' ||
      ref.kind !== 'remote' ||
      input.runtime.endpointId !== ref.endpointId ||
      (input.runtime.cwd && input.runtime.cwd !== ref.path)
    ) {
      throw terminalError('WORKSPACE_MISMATCH', 'Terminal runtime 与当前 CCLink 工作空间不匹配')
    }
    const status = await this.service.getStatus(ref)
    if (status.state !== 'online') throw terminalError('TERMINAL_OFFLINE', '远程设备不在线', true)
    if (!status.capabilities.shell.pty) {
      throw terminalError('TERMINAL_PTY_UNAVAILABLE', '当前 Agent 未声明持久远程 Terminal 能力')
    }
    const existing = this.sessions.get(input.sessionId)
    if (existing) {
      if (
        existing.serverId !== ref.endpointId ||
        existing.workspaceId !== ref.workspaceId ||
        existing.workspacePath !== ref.path
      )
        throw terminalError('WORKSPACE_MISMATCH', 'Terminal session 已绑定到其他远程工作空间')
      return {
        sessionId: input.sessionId,
        status: 'running',
        processId: `cclink:${ref.endpointId}:${existing.terminalId}`,
      }
    }
    const terminalId = stableId('term', input.sessionId, ref.endpointId, ref.workspaceId, ref.path)
    const traceId = stableId('trace', input.sessionId, ref.endpointId, ref.workspaceId, ref.path)
    const size = normalizeSize(input.size)
    const session: RemotePtySession = {
      localSessionId: input.sessionId,
      terminalId,
      traceId,
      serverId: ref.endpointId,
      workspaceId: ref.workspaceId,
      workspacePath: ref.path,
      inputSeq: 0,
      lastTerminalSeq: 0,
      keepaliveTimer: null,
      attachPromise: null,
      attachRetryTimer: null,
      attachAttempts: 0,
      replayGapNotified: false,
    }
    if (input.resume) {
      const expectedProcessId = `cclink:${ref.endpointId}:${terminalId}`
      if (String(input.resume.processId) !== expectedProcessId) {
        throw terminalError(
          'TERMINAL_LEGACY_RESUME_UNSUPPORTED',
          '该远程 Terminal 来自旧版本，无法安全恢复；请显式重启 Terminal',
          false,
        )
      }
      this.sessions.set(input.sessionId, session)
      this.byTerminalId.set(terminalId, session)
      try {
        await this.attachSession(session, false)
      } catch (error) {
        this.sessions.delete(input.sessionId)
        this.byTerminalId.delete(terminalId)
        throw error
      }
      const processId = `cclink:${ref.endpointId}:${terminalId}`
      this.emit({ kind: 'started', sessionId: input.sessionId, processId, timestamp: Date.now() })
      return { sessionId: input.sessionId, status: 'running', processId }
    }
    let response: CclinkTerminalPtyOpenResponseMessage
    try {
      response = (await this.client.request(
        ref.endpointId,
        {
          ...createCclinkEnvelope('terminal_pty_open', { trace_id: traceId }),
          agent_id: ref.endpointId,
          terminal_id: terminalId,
          workspace_id: ref.workspaceId,
          workspace_path: ref.path,
          cols: size.columns,
          rows: size.rows,
          pty_protocol_version: 1,
        },
        ['terminal_pty_open_response'],
        20_000,
      )) as CclinkTerminalPtyOpenResponseMessage
    } catch (error) {
      this.service.recordDiagnostic('terminal.open', ref.endpointId, error)
      throw error
    }
    if (
      response.status !== 'ok' ||
      response.terminal_id !== terminalId ||
      response.trace_id !== traceId ||
      response.agent_id !== ref.endpointId ||
      response.workspace_id !== ref.workspaceId ||
      response.workspace_path !== ref.path ||
      response.pty_protocol_version !== 1
    ) {
      const error = terminalError(
        response.code || 'WORKSPACE_MISMATCH',
        response.message || 'Agent 未确认远程 Terminal 的完整项目绑定',
      )
      this.service.recordDiagnostic('terminal.open', ref.endpointId, error)
      throw error
    }
    this.sessions.set(input.sessionId, session)
    this.byTerminalId.set(terminalId, session)
    session.lastTerminalSeq = response.terminal_seq ?? 0
    session.keepaliveTimer = this.keepalive(session, response.lease_timeout_ms)
    this.realtimeOnline = true
    const processId = `cclink:${ref.endpointId}:${terminalId}`
    this.emit({ kind: 'started', sessionId: input.sessionId, processId, timestamp: Date.now() })
    return { sessionId: input.sessionId, status: 'running', processId }
  }

  async write(input: TerminalWriteInput): Promise<void> {
    const session = this.requireSession(input.sessionId)
    if (input.data === '\u0003') {
      await this.operation(session, 'terminal_pty_interrupt', 'terminal_pty_interrupt_response')
      return
    }
    if (Buffer.byteLength(input.data, 'utf8') > 8 * 1024) {
      throw terminalError('TERMINAL_INVALID_REQUEST', '单次远程 Terminal 输入不能超过 8 KiB')
    }
    try {
      await this.client.send(session.serverId, {
        ...createCclinkEnvelope('terminal_pty_input', { trace_id: session.traceId }),
        terminal_id: session.terminalId,
        input_seq: ++session.inputSeq,
        data: input.data,
      })
    } catch (error) {
      this.service.recordDiagnostic('terminal.input', session.serverId, error)
      throw error
    }
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    const session = this.requireSession(sessionId)
    const normalized = normalizeSize(size)
    try {
      const response = (await this.client.request(
        session.serverId,
        {
          ...createCclinkEnvelope('terminal_pty_resize', { trace_id: session.traceId }),
          terminal_id: session.terminalId,
          cols: normalized.columns,
          rows: normalized.rows,
        },
        ['terminal_pty_resize_response'],
        10_000,
      )) as CclinkTerminalPtyResponseMessage
      assertOperation(session, response)
    } catch (error) {
      this.service.recordDiagnostic('terminal.resize', session.serverId, error)
      throw error
    }
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await this.operation(session, 'terminal_pty_close', 'terminal_pty_close_response')
    this.finish(session, { kind: 'exit', sessionId, signal: 'client_close', timestamp: Date.now() })
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async operation(
    session: RemotePtySession,
    type: 'terminal_pty_interrupt' | 'terminal_pty_close',
    responseType: 'terminal_pty_interrupt_response' | 'terminal_pty_close_response',
  ): Promise<void> {
    try {
      const response = (await this.client.request(
        session.serverId,
        {
          ...createCclinkEnvelope(type, { trace_id: session.traceId }),
          terminal_id: session.terminalId,
        },
        [responseType],
        10_000,
      )) as CclinkTerminalPtyResponseMessage
      assertOperation(session, response)
    } catch (error) {
      this.service.recordDiagnostic(`terminal.${type}`, session.serverId, error)
      throw error
    }
  }

  private handleEvent(serverId: string, message: CclinkProtocolMessage): void {
    if (!isPtyEvent(message)) return
    const session = this.byTerminalId.get(message.terminal_id)
    if (!session || session.serverId !== serverId || message.trace_id !== session.traceId) return
    if (typeof message.terminal_seq === 'number') {
      if (message.terminal_seq <= session.lastTerminalSeq) return
      if (
        message.terminal_seq > session.lastTerminalSeq + 1 &&
        !('replay' in message && message.replay)
      ) {
        this.stopKeepalive(session)
        this.scheduleAttach(session)
        return
      }
      if (
        message.terminal_seq > session.lastTerminalSeq + 1 &&
        'replay' in message &&
        message.replay &&
        !session.replayGapNotified
      ) {
        session.replayGapNotified = true
        this.emit({
          kind: 'output',
          sessionId: session.localSessionId,
          data: '\r\n[远程 Terminal 的更早输出已超出重放窗口]\r\n',
          stream: 'stderr',
          timestamp: Date.now(),
        })
      }
      session.lastTerminalSeq = message.terminal_seq
    }
    switch (message.cc_type) {
      case 'terminal_pty_output':
        if (
          message.workspace_id !== session.workspaceId ||
          message.workspace_path !== session.workspacePath
        ) {
          this.fail(session, '远程 Terminal 输出绑定了错误的工作空间')
          return
        }
        this.emit({
          kind: 'output',
          sessionId: session.localSessionId,
          data: message.data,
          stream: 'stdout',
          timestamp: Date.now(),
        })
        return
      case 'terminal_pty_state':
        if (message.state === 'error') this.fail(session, message.reason || '远程 PTY 出错')
        return
      case 'terminal_pty_exit':
        this.finish(session, {
          kind: 'exit',
          sessionId: session.localSessionId,
          exitCode: message.exit_code,
          signal: message.signal || message.reason,
          timestamp: Date.now(),
        })
        return
      case 'terminal_pty_error':
        this.fail(session, message.message, message.code)
    }
  }

  private keepalive(session: RemotePtySession, leaseTimeoutMs?: number): NodeJS.Timeout {
    const interval = Math.min(30_000, Math.max(5_000, Math.floor((leaseTimeoutMs ?? 90_000) / 3)))
    const timer = setInterval(() => {
      void this.client
        .send(session.serverId, {
          ...createCclinkEnvelope('terminal_pty_keepalive', { trace_id: session.traceId }),
          terminal_id: session.terminalId,
          last_terminal_seq: session.lastTerminalSeq,
        })
        .catch((error: unknown) => {
          if (!this.sessions.has(session.localSessionId)) return
          this.service.recordDiagnostic('terminal.keepalive', session.serverId, error)
          this.stopKeepalive(session)
          this.emit({
            kind: 'output',
            sessionId: session.localSessionId,
            data: `\r\n[远程 Terminal 连接中断：${error instanceof Error ? error.message : String(error)}]\r\n`,
            stream: 'stderr',
            timestamp: Date.now(),
          })
          this.scheduleAttach(session)
        })
    }, interval)
    timer.unref()
    return timer
  }

  private handleConnectionStatus(online: boolean): void {
    this.realtimeOnline = online
    for (const session of this.sessions.values()) {
      if (!online) this.stopKeepalive(session)
      else this.scheduleAttach(session)
    }
  }

  private scheduleAttach(session: RemotePtySession): void {
    if (
      !this.realtimeOnline ||
      session.attachPromise ||
      session.attachRetryTimer ||
      session.keepaliveTimer ||
      session.attachAttempts >= 5
    )
      return
    session.attachPromise = this.attachSession(session, true).finally(() => {
      session.attachPromise = null
    })
  }

  private async attachSession(session: RemotePtySession, retryOnFailure: boolean): Promise<void> {
    try {
      const response = (await this.client.request(
        session.serverId,
        {
          ...createCclinkEnvelope('terminal_pty_attach', { trace_id: session.traceId }),
          terminal_id: session.terminalId,
          last_terminal_seq: session.lastTerminalSeq,
        },
        ['terminal_pty_attach_response'],
        20_000,
      )) as CclinkTerminalPtyResponseMessage
      assertAttach(session, response)
      if (!this.sessions.has(session.localSessionId)) return
      if (response.replay_truncated) {
        const suffix =
          typeof response.first_available_seq === 'number'
            ? `；现存序列从 ${response.first_available_seq} 开始`
            : ''
        this.emit({
          kind: 'output',
          sessionId: session.localSessionId,
          data: `\r\n[远程 Terminal 重连成功，但部分离线输出已无法重放${suffix}]\r\n`,
          stream: 'stderr',
          timestamp: Date.now(),
        })
      }
      session.attachAttempts = 0
      session.replayGapNotified = false
      if (this.realtimeOnline) session.keepaliveTimer = this.keepalive(session)
    } catch (error) {
      if (!this.sessions.has(session.localSessionId)) return
      const message = error instanceof Error ? error.message : String(error)
      this.service.recordDiagnostic('terminal.attach', session.serverId, error)
      if (!retryOnFailure) {
        throw terminalError('TERMINAL_ATTACH_FAILED', message, true)
      }
      session.attachAttempts += 1
      this.emit({
        kind: 'output',
        sessionId: session.localSessionId,
        data: `\r\n[远程 Terminal 恢复失败（${session.attachAttempts}/5）：${message}]\r\n`,
        stream: 'stderr',
        timestamp: Date.now(),
      })
      if (session.attachAttempts < 5 && this.realtimeOnline) {
        const delay = Math.min(30_000, 1_000 * 2 ** (session.attachAttempts - 1))
        session.attachRetryTimer = setTimeout(() => {
          session.attachRetryTimer = null
          this.scheduleAttach(session)
        }, delay)
        session.attachRetryTimer.unref()
      }
    }
  }

  private stopKeepalive(session: RemotePtySession): void {
    if (session.keepaliveTimer) clearInterval(session.keepaliveTimer)
    session.keepaliveTimer = null
  }

  private requireSession(sessionId: string): RemotePtySession {
    const session = this.sessions.get(sessionId)
    if (!session) throw terminalError('TERMINAL_NOT_FOUND', '远程 Terminal 不存在或已经退出', true)
    return session
  }

  private fail(session: RemotePtySession, message: string, code = 'TERMINAL_REMOTE_ERROR'): void {
    this.service.recordDiagnostic(
      'terminal.event',
      session.serverId,
      terminalError(code, message, true),
    )
    this.finish(session, {
      kind: 'error',
      sessionId: session.localSessionId,
      message,
      executionError: terminalErrorInfo(code, message, true),
      timestamp: Date.now(),
    })
  }

  private finish(session: RemotePtySession, event: TerminalExecutionEvent): void {
    this.stopKeepalive(session)
    if (session.attachRetryTimer) clearTimeout(session.attachRetryTimer)
    session.attachRetryTimer = null
    this.sessions.delete(session.localSessionId)
    this.byTerminalId.delete(session.terminalId)
    this.emit(event)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`
}

function isPtyEvent(
  message: CclinkProtocolMessage,
): message is
  | CclinkTerminalPtyOutputMessage
  | CclinkTerminalPtyStateMessage
  | CclinkTerminalPtyExitMessage
  | CclinkTerminalPtyErrorMessage {
  return [
    'terminal_pty_output',
    'terminal_pty_state',
    'terminal_pty_exit',
    'terminal_pty_error',
  ].includes(message.cc_type)
}

function normalizeSize(size?: TerminalSize): Required<TerminalSize> {
  const columns = Math.floor(size?.columns ?? 120)
  const rows = Math.floor(size?.rows ?? 32)
  if (columns < 2 || columns > 1_000 || rows < 1 || rows > 1_000) {
    throw terminalError('TERMINAL_INVALID_SIZE', '远程 Terminal 尺寸无效')
  }
  return { columns, rows }
}

function assertOperation(
  session: RemotePtySession,
  response: CclinkTerminalPtyResponseMessage,
): void {
  if (
    response.status !== 'ok' ||
    response.terminal_id !== session.terminalId ||
    response.trace_id !== session.traceId
  ) {
    throw terminalError(
      response.code || 'TERMINAL_CONFLICT',
      response.message || '远程 Terminal 响应不匹配',
    )
  }
}

function assertAttach(session: RemotePtySession, response: CclinkTerminalPtyResponseMessage): void {
  if (
    response.status !== 'ok' ||
    response.terminal_id !== session.terminalId ||
    response.trace_id !== session.traceId ||
    response.workspace_id !== session.workspaceId ||
    response.workspace_path !== session.workspacePath
  ) {
    throw terminalError(
      response.code || 'TERMINAL_CONFLICT',
      response.message || 'Agent 未确认恢复到原远程项目和 Terminal',
      response.code !== 'TERMINAL_FORBIDDEN',
    )
  }
}

function terminalErrorInfo(
  code: string,
  message: string,
  retryable = false,
): TerminalExecutionErrorInfo {
  return { layer: 'execution-backend', code, message, retryable }
}

function terminalError(
  code: string,
  message: string,
  retryable = false,
): Error & {
  executionError: TerminalExecutionErrorInfo
} {
  return Object.assign(new Error(message), {
    executionError: terminalErrorInfo(code, message, retryable),
  })
}
