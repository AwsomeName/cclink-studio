import { createChatccEnvelope } from '../../shared/chatcc/protocol'
import type {
  ChatccTerminalCommandMessage,
  ChatccTerminalOutputMessage,
} from '../../shared/chatcc/protocol'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'
import type { ChatccServer, ChatccWorkspace } from '../../shared/chatcc'
import type { TerminalBackend, TerminalExecutionEvent } from '../../shared/terminal'
import type { CclinkRequestClient } from '../cclink/cclink-request-router'
import {
  CclinkProtocolResponseError,
  CclinkRequestLayerError,
} from '../cclink/cclink-request-router'
import type { CclinkStore } from '../cclink/cclink-store'
import { TerminalLocalShellError } from './terminal-local-shell-adapter'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

interface RemoteTerminalSession {
  serverId: string
  workspaceId: string
  cwd?: string
}

interface ValidatedWorkspace {
  server: ChatccServer
  workspace: ChatccWorkspace
}

export class CclinkTerminalExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend: TerminalBackend = 'remote-shell'

  private readonly sessions = new Map<string, RemoteTerminalSession>()
  private readonly listeners = new Set<TerminalExecutionEventListener>()

  constructor(
    private readonly store: Pick<CclinkStore, 'listServers'>,
    private readonly requestClient: CclinkRequestClient,
    private readonly now: () => number = Date.now,
  ) {}

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    if (input.runtime.location !== 'remote' || input.runtime.transport !== 'cclink') {
      throw this.createError(input.sessionId, 'terminal.start', 'Terminal runtime 不是 CCLink 远程工作空间', false)
    }

    const workspace = await this.validateWorkspace(
      input.runtime.endpointId,
      input.runtime.workspaceRef.kind === 'remote' ? input.runtime.workspaceRef.workspaceId : '',
      input.sessionId,
    )
    this.sessions.set(input.sessionId, {
      serverId: workspace.server.id,
      workspaceId: workspace.workspace.id,
      cwd: input.runtime.cwd || workspace.workspace.path,
    })
    this.emit({
      kind: 'started',
      sessionId: input.sessionId,
      processId: `cclink:${workspace.server.id}`,
      timestamp: this.now(),
    })
    return {
      sessionId: input.sessionId,
      status: 'running',
      processId: `cclink:${workspace.server.id}`,
    }
  }

  async write(input: TerminalWriteInput): Promise<void> {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      throw this.createError(input.sessionId, 'terminal.write', 'CCLink Terminal session 不存在或尚未启动', true)
    }

    const message: ChatccTerminalCommandMessage = {
      ...createChatccEnvelope('terminal_command'),
      session_id: input.sessionId,
      content: input.data,
      cwd: session.cwd,
    }

    try {
      const response = await this.requestClient.request(session.serverId, message, {
        expectedTypes: ['terminal_output'],
        timeoutMs: 60_000,
      })
      if (response.cc_type !== 'terminal_output') {
        throw this.createError(input.sessionId, 'terminal.write', `收到非预期远程 Terminal 响应：${response.cc_type}`, true)
      }
      const output = response as ChatccTerminalOutputMessage
      this.emit({
        kind: 'output',
        sessionId: input.sessionId,
        data: output.content,
        stream: output.exit_code && output.exit_code !== 0 ? 'stderr' : 'stdout',
        timestamp: this.now(),
      })
      if (typeof output.exit_code === 'number' && output.exit_code !== 0) {
        this.emit({
          kind: 'output',
          sessionId: input.sessionId,
          data: `\n[exit code ${output.exit_code}]\n`,
          stream: 'stderr',
          timestamp: this.now(),
        })
      }
    } catch (error) {
      throw this.normalizeRequestError(input.sessionId, error)
    }
  }

  async resize(_sessionId: string, _size: TerminalSize): Promise<void> {
    // 当前 CCLink terminal_command 是单命令协议，不支持 PTY resize。
  }

  async terminate(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
    this.emit({
      kind: 'exit',
      sessionId,
      exitCode: undefined,
      signal: 'terminated',
      timestamp: this.now(),
    })
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private async validateWorkspace(
    serverId: string | undefined,
    workspaceId: string,
    sessionId: string,
  ): Promise<ValidatedWorkspace> {
    if (!serverId || !workspaceId) {
      throw this.createError(sessionId, 'terminal.start', '缺少远程设备或工作空间 ID', false)
    }
    const servers = await this.store.listServers()
    const server = servers.find((item) => item.id === serverId)
    if (!server) {
      throw this.createError(sessionId, 'terminal.start', '远程设备不存在或尚未同步', true)
    }
    const workspace = server.workspaces.find((item) => item.id === workspaceId)
    if (!workspace) {
      throw this.createError(sessionId, 'terminal.start', '远程工作空间不存在或尚未同步', true)
    }
    if (server.status !== 'online') {
      throw this.createError(sessionId, 'terminal.start', `远程设备当前${server.status === 'connecting' ? '连接中' : '离线'}，无法执行命令`, true)
    }
    return { server, workspace }
  }

  private normalizeRequestError(sessionId: string, error: unknown): TerminalLocalShellError {
    if (error instanceof TerminalLocalShellError) return error
    if (error instanceof CclinkProtocolResponseError) {
      return this.createError(
        sessionId,
        'terminal.write',
        error.message,
        true,
        error.errorType || REMOTE_ERROR_CODE.AGENT_ERROR,
      )
    }
    if (error instanceof CclinkRequestLayerError) {
      const remoteError: RemoteError = {
        ...error.remoteError,
        context: {
          ...error.remoteError.context,
          sessionId,
        },
      }
      this.emit({
        kind: 'error',
        sessionId,
        message: remoteError.message,
        remoteError,
        timestamp: this.now(),
      })
      return new TerminalLocalShellError(remoteError)
    }
    return this.createError(
      sessionId,
      'terminal.write',
      error instanceof Error ? error.message : String(error),
      true,
      REMOTE_ERROR_CODE.AGENT_ERROR,
    )
  }

  private createError(
    sessionId: string,
    operation: string,
    message: string,
    retryable: boolean,
    code: string = REMOTE_ERROR_CODE.EXECUTION_BACKEND_UNAVAILABLE,
  ): TerminalLocalShellError {
    const remoteError: RemoteError = {
      layer: 'execution-backend',
      code,
      message,
      retryable,
      context: {
        backend: this.backend,
        operation,
        sessionId,
      },
    }
    this.emit({
      kind: 'error',
      sessionId,
      message,
      remoteError,
      timestamp: this.now(),
    })
    return new TerminalLocalShellError(remoteError)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
