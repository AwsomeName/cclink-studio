import {
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
  type ClientConnection,
  type RequestPermissionRequest,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import type {
  AgentBackendStatus,
  AgentEventHandler,
  AgentSendOptions,
  IAgentBackend,
} from './types.js'

const execFileAsync = promisify(execFile)

export const CODEX_ACP_IMPLEMENTATION_ID = 'codex-acp'
export const CODEX_ACP_EXPECTED_VERSION = '1.3.0'

export interface AcpPermissionDecisionRequest {
  conversationId?: string
  runId?: string
  toolName: string
  params: Record<string, unknown>
  riskLevel: 'read' | 'write' | 'destructive'
  reason?: string
}

export interface LocalAcpBackendOptions {
  executablePath?: string
  apiKey?: string
  codexHome: string
  expectedVersion?: string
  getWorkspacePath?: () => string
  requestPermission: (request: AcpPermissionDecisionRequest) => Promise<boolean>
}

export interface CodexAcpProbeResult {
  executable: string
  version: string
}

export function buildCodexAcpEnvironment(input: {
  apiKey?: string
  codexHome: string
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: input.codexHome,
    CODEX_HOME: input.codexHome,
    NO_BROWSER: '1',
    INITIAL_AGENT_MODE: 'agent',
    DISABLE_UPDATES: '1',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? 'en_US.UTF-8',
    TERM: process.env.TERM ?? 'xterm-256color',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  }
  if (input.apiKey?.trim()) environment.CODEX_API_KEY = input.apiKey.trim()
  return environment
}

export async function probeCodexAcpExecutable(input: {
  executablePath?: string
  codexHome: string
  expectedVersion?: string
}): Promise<CodexAcpProbeResult> {
  const executable = input.executablePath?.trim() || 'codex-acp'
  await mkdir(input.codexHome, { recursive: true, mode: 0o700 })
  const result = await execFileAsync(executable, ['--version'], {
    env: buildCodexAcpEnvironment({ codexHome: input.codexHome }),
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  })
  const output = result.stdout.trim()
  const match = output.match(/^@agentclientprotocol\/codex-acp\s+(\S+)$/)
  if (!match) throw new Error(`无法识别 Codex ACP 版本：${output || '没有输出'}`)
  const expectedVersion = input.expectedVersion ?? CODEX_ACP_EXPECTED_VERSION
  if (match[1] !== expectedVersion) {
    throw new Error(`Codex ACP 版本不兼容：需要 ${expectedVersion}，当前 ${match[1]}`)
  }
  return { executable, version: match[1] }
}

export class LocalAcpBackend implements IAgentBackend {
  private eventHandler: AgentEventHandler | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private connection: ClientConnection | null = null
  private sessionId: string | null = null
  private sessionAttached = false
  private currentOptions: AgentSendOptions | null = null
  private currentPrompt: Promise<unknown> | null = null
  private currentText = ''
  private turnRevision = 0
  private destroyed = false
  private stderr = ''
  private startPromise: Promise<void> | null = null

  constructor(private readonly options: LocalAcpBackendOptions) {}

  onEvent(handler: AgentEventHandler): void {
    this.eventHandler = handler
  }

  async start(): Promise<void> {
    if (this.connection) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startProcess().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async sendMessage(message: string, options?: AgentSendOptions): Promise<void> {
    if (this.currentPrompt) throw new Error('Codex ACP 正在响应中')
    if (options?.images?.length) {
      throw new Error('Codex ACP 最小版本暂不支持图片附件，请改用文字或 Claude Code')
    }
    if (!this.options.apiKey?.trim()) {
      throw new Error('Codex ACP 尚未配置 OpenAI API Key，请先到设置中填写')
    }
    this.currentOptions = options ?? null
    const turnRevision = ++this.turnRevision
    this.currentText = ''
    try {
      await this.start()
      const sessionId = await this.ensureSession(options)
      const promptText = options?.agentProfile
        ? [
            'CCLink Studio 已为当前 Thread 绑定以下可信角色说明：',
            options.agentProfile.systemInstructions,
            '',
            '用户消息：',
            message,
          ].join('\n')
        : message
      const prompt = this.connection!.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: promptText }],
      })
      this.currentPrompt = prompt
      const result = await prompt
      if (turnRevision !== this.turnRevision) return
      this.emit('complete', {
        protocol: 'studio-agent-event-v1',
        event: {
          type: 'complete',
          sessionId,
          stopReason: result.stopReason,
          text: this.currentText,
          usage: result.usage ?? null,
        },
        result: this.currentText,
        session_id: sessionId,
        is_error: false,
      })
    } catch (error) {
      if (turnRevision !== this.turnRevision) return
      if (this.currentPrompt) {
        this.emit('error', {
          protocol: 'studio-agent-event-v1',
          code: 'acp_prompt_failed',
          message: this.errorMessage(error),
        })
      }
      throw error
    } finally {
      if (turnRevision === this.turnRevision) {
        this.currentPrompt = null
        this.currentOptions = null
        this.currentText = ''
      }
    }
  }

  async abort(): Promise<void> {
    this.turnRevision += 1
    if (this.connection && this.sessionId && this.currentPrompt) {
      await this.connection.agent
        .notify('session/cancel', { sessionId: this.sessionId })
        .catch(() => undefined)
    }
    this.currentPrompt = null
    this.currentOptions = null
  }

  getStatus(): AgentBackendStatus {
    return { connected: this.currentPrompt !== null, sessionId: this.sessionId }
  }

  resetSession(): void {
    const previousSessionId = this.sessionId
    this.sessionId = null
    this.sessionAttached = false
    if (this.connection && previousSessionId) {
      void this.connection.agent
        .request('session/close', { sessionId: previousSessionId })
        .catch(() => undefined)
    }
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  setSessionId(sessionId: string | null): void {
    if (this.sessionId === sessionId) return
    this.sessionId = sessionId
    this.sessionAttached = false
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    await this.abort()
    const connection = this.connection
    const child = this.child
    this.connection = null
    this.child = null
    if (connection && this.sessionId) {
      await connection.agent
        .request('session/close', { sessionId: this.sessionId })
        .catch(() => undefined)
    }
    connection?.close()
    if (child && !child.killed) child.kill()
    this.eventHandler = null
  }

  private async startProcess(): Promise<void> {
    const apiKey = this.options.apiKey?.trim()
    if (!apiKey) throw new Error('Codex ACP 尚未配置 OpenAI API Key，请先到设置中填写')
    const probe = await probeCodexAcpExecutable({
      executablePath: this.options.executablePath,
      codexHome: this.options.codexHome,
      expectedVersion: this.options.expectedVersion,
    })
    const child = spawn(probe.executable, [], {
      env: buildCodexAcpEnvironment({ apiKey, codexHome: this.options.codexHome }),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8_192)
    })
    child.once('error', (error) => this.handleProcessExit(error))
    child.once('exit', (code, signal) => {
      this.handleProcessExit(
        new Error(
          `Codex ACP 已退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）${
            this.safeStderr() ? `: ${this.safeStderr()}` : ''
          }`,
        ),
      )
    })

    const app = client({ name: 'cclink-studio' })
      .onRequest('session/request_permission', ({ params }) => this.handlePermission(params))
      .onNotification('session/update', ({ params }) => this.handleSessionUpdate(params))
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    )
    const connection = app.connect(stream)
    this.connection = connection
    try {
      const initialized = await connection.agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          auth: { terminal: false },
        },
        clientInfo: { name: 'cclink-studio', title: 'CCLink Studio', version: '1' },
      })
      if (initialized.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `ACP 协议不兼容：需要 ${PROTOCOL_VERSION}，当前 ${initialized.protocolVersion}`,
        )
      }
      if (initialized.agentInfo?.name !== '@agentclientprotocol/codex-acp') {
        throw new Error(`ACP 实现不匹配：${initialized.agentInfo?.name ?? '未知实现'}`)
      }
      if (!initialized.authMethods?.some((method) => method.id === 'api-key')) {
        throw new Error('Codex ACP 没有提供 API Key 认证')
      }
      await connection.agent.request('authenticate', { methodId: 'api-key' })
    } catch (error) {
      this.connection = null
      this.child = null
      connection.close(error)
      if (!child.killed) child.kill()
      throw error
    }
  }

  private async ensureSession(options?: AgentSendOptions): Promise<string> {
    if (!this.connection) throw new Error('Codex ACP 连接未就绪')
    const cwd = options?.workspacePath || this.options.getWorkspacePath?.() || process.cwd()
    if (this.sessionId && !this.sessionAttached) {
      try {
        await this.connection.agent.request('session/resume', {
          sessionId: this.sessionId,
          cwd,
          mcpServers: [],
        })
        this.sessionAttached = true
        this.emitSession(this.sessionId, 'resumed')
        return this.sessionId
      } catch {
        this.sessionId = null
        this.sessionAttached = false
        this.emit('stream', {
          protocol: 'studio-agent-event-v1',
          event: {
            type: 'notice',
            text: '原 Codex ACP Session 无法恢复，已保留历史并建立新 Session。',
          },
        })
      }
    }
    if (!this.sessionId) {
      const session = await this.connection.agent.request('session/new', {
        cwd,
        mcpServers: [],
      })
      this.sessionId = session.sessionId
      this.sessionAttached = true
      this.emitSession(session.sessionId, 'created')
    }
    return this.sessionId
  }

  private async handlePermission(params: RequestPermissionRequest) {
    const allowOnce = params.options.find((option) => option.kind === 'allow_once')
    const rejectOnce = params.options.find((option) => option.kind === 'reject_once')
    const approved = await this.options.requestPermission({
      conversationId: this.currentOptions?.conversationId,
      runId: this.currentOptions?.runId,
      toolName:
        params.toolCall.name || params.toolCall.title || params.toolCall.kind || 'Codex 工具',
      params: this.toRecord(params.toolCall.rawInput),
      riskLevel: this.riskLevel(params.toolCall.kind),
      reason: params.toolCall.title ?? undefined,
    })
    const selected = approved ? allowOnce : rejectOnce
    return selected
      ? { outcome: { outcome: 'selected' as const, optionId: selected.optionId } }
      : { outcome: { outcome: 'cancelled' as const } }
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    if (notification.sessionId !== this.sessionId) return
    const update = notification.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      this.currentText += update.content.text
      this.emit('stream', {
        protocol: 'studio-agent-event-v1',
        event: {
          type: 'text-delta',
          messageId: update.messageId ?? null,
          text: update.content.text,
        },
      })
      return
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      this.emit('stream', {
        protocol: 'studio-agent-event-v1',
        event: {
          type: 'thought-delta',
          messageId: update.messageId ?? null,
          text: update.content.text,
        },
      })
      return
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.emitToolUpdate(update)
    }
  }

  private emitToolUpdate(
    update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
  ): void {
    this.emit('stream', {
      protocol: 'studio-agent-event-v1',
      event: {
        type: 'tool',
        action: update.sessionUpdate === 'tool_call' ? 'start' : 'update',
        toolCallId: update.toolCallId,
        name: update.name ?? update.title ?? update.kind ?? 'Codex 工具',
        title: update.title ?? null,
        kind: update.kind ?? null,
        status: update.status ?? null,
        input: update.rawInput ?? null,
        output: update.rawOutput ?? null,
      },
    })
  }

  private emitSession(sessionId: string, state: 'created' | 'resumed'): void {
    this.emit('stream', {
      protocol: 'studio-agent-event-v1',
      event: { type: 'session', sessionId, state },
    })
  }

  private handleProcessExit(error: Error): void {
    if (this.destroyed || !this.connection) return
    this.connection.close(error)
    this.connection = null
    this.child = null
    this.sessionAttached = false
  }

  private riskLevel(
    kind: RequestPermissionRequest['toolCall']['kind'],
  ): 'read' | 'write' | 'destructive' {
    if (kind === 'read' || kind === 'search' || kind === 'think') return 'read'
    if (kind === 'delete' || kind === 'move') return 'destructive'
    return 'write'
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value }
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    const secret = this.options.apiKey?.trim()
    return secret ? message.replaceAll(secret, '[redacted]') : message
  }

  private safeStderr(): string {
    return this.errorMessage(this.stderr.trim())
  }

  private emit(type: 'stream' | 'complete' | 'error' | 'system', data: unknown): void {
    this.eventHandler?.(type, data)
  }
}
