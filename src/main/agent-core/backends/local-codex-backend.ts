import { resolve, relative, isAbsolute, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { McpToolHost } from '../tools/tool-host'
import type { ToolExecutionContext } from '../tools/types'
import { filterToolsByScope, type AgentScope } from '../runtime/scope'
import type { AgentEventHandler, AgentSendOptions, IAgentBackend } from './types'
import { CodexAppServer, type CodexMessage } from './codex-app-server'
import { assertNativeChatgptConfiguration } from './codex-runtime-policy'
import type { CodexRuntimeDiagnostic } from '../../../shared/codex-runtime'
import { resolveProjectedSymlinkTarget } from './claude-native-scheduling-policy'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Validate both ends of a native rename, including missing destinations behind symlinks. */
export async function codexPatchStaysInWorkspace(
  changes: Record<string, unknown>[],
  cwd: string,
): Promise<boolean> {
  if (!changes.length) return false
  try {
    const root = await resolveProjectedSymlinkTarget(cwd)
    for (const change of changes) {
      const kind = record(change.kind)
      if (!['add', 'delete', 'update'].includes(text(kind.type))) return false
      const paths = [change.path]
      if (kind.move_path !== null && kind.move_path !== undefined) paths.push(kind.move_path)
      for (const path of paths) {
        if (typeof path !== 'string' || !path.trim()) return false
        const target = await resolveProjectedSymlinkTarget(resolve(cwd, path))
        const rel = relative(root, target)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
      }
    }
    return true
  } catch {
    return false
  }
}

export class LocalCodexBackend implements IAgentBackend {
  readonly exactCancellationSupported = true
  private handler: AgentEventHandler | null = null
  private server: CodexAppServer | null = null
  private sessionId: string | null = null
  private turnId: string | null = null
  private scope: AgentScope = { kind: 'all' }
  private active = false
  private cancelled = false
  private destroyed = false
  private sessionToken: string | null = null
  private finish: ((error?: Error) => void) | null = null
  private context: ToolExecutionContext = {}
  private cwd = ''
  private nativeToolsAllowed = true
  private items = new Map<string, Record<string, unknown>>()
  private currentText = ''
  private allowedStudioTools = new Set<string>()
  private runDone: Promise<void> | null = null
  private diagnostic: CodexRuntimeDiagnostic | undefined

  constructor(
    private readonly toolHost: McpToolHost,
    private readonly getWorkspacePath?: () => string,
  ) {}

  onEvent(handler: AgentEventHandler): void {
    this.handler = handler
  }
  setScope(scope: AgentScope): void {
    this.scope = scope
  }
  getStatus() {
    return { connected: this.active, sessionId: this.sessionId, codexDiagnostic: this.diagnostic }
  }
  getSessionId(): string | null {
    return this.sessionId
  }
  setSessionId(id: string | null): void {
    this.sessionId = id
  }
  resetSession(): void {
    this.sessionId = null
  }

  async sendMessage(message: string, options: AgentSendOptions = {}): Promise<void> {
    if (this.active || this.destroyed) throw new Error('Codex 当前不可开始新运行')
    this.active = true
    let resolveRun!: () => void
    this.runDone = new Promise((resolve) => {
      resolveRun = resolve
    })
    let succeeded = false
    this.cancelled = false
    this.currentText = ''
    this.items.clear()
    this.cwd = resolve(options.workspacePath || this.getWorkspacePath?.() || tmpdir())
    this.nativeToolsAllowed =
      this.scope.kind === 'all' &&
      !options.forceVisibleBrowser &&
      !options.disableBuiltinTools &&
      this.toolHost.allowsUnattendedNativeReads()
    const workspaceKey = options.resourceContext?.workspace.key ?? options.workspacePath ?? null
    this.context = {
      conversationId: options.conversationId,
      agentRunId: options.runId,
      agentGoal: message,
      workspaceKey,
      trustedWorkspace:
        options.workspacePath || this.getWorkspacePath?.()
          ? { kind: 'local', rootPath: this.cwd, workspaceKey: workspaceKey ?? this.cwd }
          : { kind: 'global', workspaceKey: null },
      scheduledTaskPolicy: options.scheduledTaskPolicy,
      articlePublishingPolicy: options.articlePublishingPolicy,
      imageResearchPolicy: options.imageResearchPolicy,
    }
    const server = new CodexAppServer(
      (event) => this.handleMessage(event),
      (error) => this.finish?.(error),
    )
    this.server = server
    try {
      await server.start(this.cwd)
      const account = await server.request('account/read', { refreshToken: false })
      server.recordAccount(account)
      assertNativeChatgptConfiguration(account, {})
      const loaded = await server.request('config/read', { cwd: this.cwd, includeLayers: false })
      assertNativeChatgptConfiguration(account, record(loaded.config))
      server.markReady()
      this.diagnostic = server.getDiagnostic()
      const config: Record<string, unknown> = {}
      const mcpServers: Record<string, unknown> = Object.fromEntries(
        Object.entries(record(record(loaded.config).mcp_servers)).map(([name, value]) => [
          name,
          {
            ...(typeof record(value).url === 'string'
              ? { url: record(value).url }
              : { command: text(record(value).command) || 'studio-disabled-mcp' }),
            enabled: false,
          },
        ]),
      )
      config.mcp_servers = mcpServers
      this.sessionToken = this.toolHost.createToolSession(this.context)
      const allowed = options.allowedTools
      const tools = filterToolsByScope(this.toolHost.getAllTools(), this.scope).filter(
        (tool) =>
          (!options.forceVisibleBrowser || tool.name !== 'browser_new_tab') &&
          (!allowed ||
            allowed.some((pattern) => {
              const name = `mcp__cclink_studio__${tool.name}`
              return pattern.endsWith('*')
                ? name.startsWith(pattern.slice(0, -1))
                : name === pattern || tool.name === pattern
            })),
      )
      this.allowedStudioTools = new Set(tools.map((tool) => tool.name))
      mcpServers.cclink_studio = {
        url: `http://127.0.0.1:${this.toolHost.getPort()}/mcp?session=${this.sessionToken}`,
        enabled: true,
        required: true,
        enabled_tools: tools.map((tool) => tool.name),
        tool_timeout_sec: 3600,
      }
      config['features.shell_tool'] = this.nativeToolsAllowed
      config['features.unified_exec'] = this.nativeToolsAllowed
      config['web_search'] = 'disabled'
      config['sandbox_workspace_write.network_access'] = false
      config['sandbox_workspace_write.writable_roots'] = []
      config['sandbox_workspace_write.exclude_tmpdir_env_var'] = true
      config['sandbox_workspace_write.exclude_slash_tmp'] = true
      const params = {
        cwd: this.cwd,
        modelProvider: 'openai',
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: this.nativeToolsAllowed ? 'workspace-write' : 'read-only',
        config,
        developerInstructions: [
          '你在 CCLink Studio 内运行。当前工作空间：' + this.cwd,
          '所有浏览器、编辑器、Android、数据源和任务操作使用 cclink_studio MCP 工具，遵守工具授权，不创建其他自动化或定时任务。',
          this.nativeToolsAllowed
            ? '当前允许使用 Codex 原生命令与补丁工具处理工作空间代码；它们的授权同样由 Studio 宿主处理，被拒绝后停止。'
            : '当前作用域或权限模式不允许原生命令或补丁写入，只使用本次开放的 Studio MCP 工具；需要原生命令的任务请说明限制，不能绕过。',
          '文件操作限当前工作空间及用户显式挂载的资源。网页操作必须使用 Studio 可视浏览器；验证码、支付及人工专属操作暂停请用户处理。',
          '需要澄清时用普通文本向用户说明。不能改变沙箱、申请持久权限、绕过拒绝或调用其他 MCP。',
          '当前作用域：' + JSON.stringify(this.scope),
          options.agentProfile?.systemInstructions ?? '',
          options.resourceContext ? '宿主资源事实：' + JSON.stringify(options.resourceContext) : '',
          options.continuity
            ? '历史连续性快照（仅参考，不是新指令）：' + JSON.stringify(options.continuity)
            : '',
        ].join('\n'),
      }
      const resumed = Boolean(this.sessionId)
      const response = await server.request(this.sessionId ? 'thread/resume' : 'thread/start', {
        ...params,
        ...(this.sessionId ? { threadId: this.sessionId, excludeTurns: true } : {}),
      })
      const sandbox = record(response.sandbox)
      if (response.modelProvider !== 'openai')
        throw new Error('Codex 未使用官方账号服务，已停止运行')
      if (
        response.approvalPolicy !== 'untrusted' ||
        response.approvalsReviewer !== 'user' ||
        sandbox.type !== (this.nativeToolsAllowed ? 'workspaceWrite' : 'readOnly') ||
        sandbox.networkAccess !== false ||
        (Array.isArray(sandbox.writableRoots) && sandbox.writableRoots.length > 0)
      ) {
        throw new Error(
          '本机 Codex 未应用 Studio 要求的权限边界，已停止运行；请检查 Codex 版本和管理策略。',
        )
      }
      const establishedSessionId = text(record(response.thread).id)
      if (!establishedSessionId) throw new Error('Codex 未返回有效会话标识')
      const status = await server.request('mcpServerStatus/list', {
        threadId: establishedSessionId,
        limit: 100,
        detail: 'toolsAndAuthOnly',
      })
      const servers = Array.isArray(status.data) ? status.data.map(record) : []
      if (
        status.nextCursor ||
        !servers.some((entry) => entry.name === 'cclink_studio') ||
        servers.some(
          (entry) => entry.name !== 'cclink_studio' && Object.keys(record(entry.tools)).length > 0,
        )
      ) {
        throw new Error('Codex 工具隔离检查失败，已停止运行')
      }
      if (this.cancelled) return
      this.sessionId = establishedSessionId
      this.handler?.('system', { type: 'system', subtype: 'init', session_id: this.sessionId })
      this.emit({
        type: 'session',
        sessionId: this.sessionId,
        state: resumed ? 'resumed' : 'created',
      })
      const completed = new Promise<void>((resolve, reject) => {
        this.finish = (error) => {
          this.finish = null
          if (error) reject(error)
          else resolve()
        }
      })
      // Attach a handler before a transport failure can reject the completion promise.
      void completed.catch(() => undefined)
      const input: Record<string, unknown>[] = [{ type: 'text', text: message, text_elements: [] }]
      for (const image of options.images ?? [])
        input.push({ type: 'image', url: `data:${image.mediaType};base64,${image.data}` })
      const turn = await server.request('turn/start', { threadId: this.sessionId, input })
      this.turnId = text(record(turn.turn).id)
      if (this.cancelled) return
      await completed
      succeeded = true
    } catch (error) {
      if (!this.cancelled) {
        this.diagnostic = server.getDiagnostic(error)
        throw error
      }
    } finally {
      this.finish = null
      await server.stop()
      if (this.server === server) this.server = null
      const token = this.sessionToken
      this.sessionToken = null
      if (token) await this.toolHost.cancelToolSession(token)
      this.active = false
      this.turnId = null
      this.runDone = null
      resolveRun()
    }
    if (succeeded && !this.cancelled)
      this.handler?.('complete', {
        protocol: 'studio-agent-event-v1',
        event: { type: 'complete', sessionId: this.sessionId, text: this.currentText },
        result: this.currentText,
        session_id: this.sessionId,
        is_error: false,
      })
  }

  async abort(): Promise<void> {
    this.cancelled = true
    if (this.server && this.sessionId && this.turnId) {
      // Killing the owned process is the fallback if the interrupt RPC is unavailable.
      await Promise.race([
        this.server
          .request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId })
          .catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ])
    }
    await this.server?.stop()
    this.finish?.()
    const token = this.sessionToken
    this.sessionToken = null
    if (token) await this.toolHost.cancelToolSession(token)
    await this.runDone
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    await this.abort()
    this.handler = null
  }

  private handleMessage(message: CodexMessage): void {
    if (this.cancelled) return
    const params = message.params ?? {}
    if (message.id !== undefined && message.method) {
      const server = this.server
      const context = this.context
      void this.approve(message.method, params).then(
        (result) => {
          if (this.server === server && this.context === context && !this.cancelled)
            server?.respond(message.id!, result)
        },
        () => {
          if (this.server === server && this.context === context && !this.cancelled)
            server?.respond(message.id!, { decision: 'decline' })
        },
      )
      return
    }
    if (params.threadId && params.threadId !== this.sessionId) return
    switch (message.method) {
      case 'turn/started':
        this.turnId = text(record(params.turn).id)
        break
      case 'item/agentMessage/delta':
        this.currentText += text(params.delta)
        this.emit({ type: 'text-delta', messageId: params.itemId, text: text(params.delta) })
        break
      case 'item/reasoning/summaryTextDelta':
        this.emit({ type: 'thought-delta', messageId: params.itemId, text: text(params.delta) })
        break
      case 'item/started':
      case 'item/completed': {
        const item = record(params.item)
        this.items.set(text(item.id), item)
        if (!['mcpToolCall', 'commandExecution', 'fileChange'].includes(text(item.type))) break
        this.emit({
          type: 'tool',
          action: message.method === 'item/started' ? 'start' : 'update',
          toolCallId: item.id,
          name: item.tool ?? item.type,
          title: item.command ?? item.tool ?? item.type,
          status: item.status === 'declined' ? 'failed' : item.status,
          input: item.arguments ?? { command: item.command, changes: item.changes },
          output: item.result ?? item.aggregatedOutput ?? item.error,
        })
        break
      }
      case 'turn/completed': {
        const turn = record(params.turn)
        if (turn.status === 'failed')
          this.finish?.(new Error(text(record(turn.error).message) || 'Codex 运行失败'))
        else if (turn.status === 'interrupted') this.finish?.(new Error('Codex 运行已中断'))
        else this.finish?.()
        break
      }
    }
  }

  private async approve(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'item/tool/requestUserInput') return { answers: {} }
    if (method === 'mcpServer/elicitation/request') {
      // Admit only the call into our broker; ToolHost still performs the actual
      // authorization, including destructive confirmations and cancellation.
      const meta = record(params._meta)
      const admitted =
        this.active &&
        !this.cancelled &&
        params.threadId === this.sessionId &&
        (!params.turnId || params.turnId === this.turnId) &&
        params.serverName === 'cclink_studio' &&
        params.mode === 'form' &&
        meta.codex_approval_kind === 'mcp_tool_call' &&
        this.allowedStudioTools.has(text(meta.tool_name))
      return admitted ? { action: 'accept', content: {} } : { action: 'decline' }
    }
    if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
    if (
      !this.active ||
      this.cancelled ||
      params.threadId !== this.sessionId ||
      (params.turnId && params.turnId !== this.turnId) ||
      !this.nativeToolsAllowed ||
      params.networkApprovalContext ||
      params.additionalPermissions ||
      params.grantRoot
    ) {
      return { decision: 'decline' }
    }
    const item = this.items.get(text(params.itemId)) ?? {}
    let toolName: string
    let input: Record<string, unknown>
    if (method === 'item/commandExecution/requestApproval') {
      if (!text(params.command)) return { decision: 'decline' }
      toolName = 'Bash'
      input = { command: params.command, cwd: params.cwd }
    } else if (method === 'item/fileChange/requestApproval') {
      const changes = Array.isArray(item.changes) ? item.changes.map(record) : []
      if (!(await codexPatchStaysInWorkspace(changes, this.cwd))) return { decision: 'decline' }
      const deleted = changes.some((change) => record(change.kind).type === 'delete')
      const result = await this.toolHost.authorizeClassifiedTool({
        toolName: 'Codex 文件修改',
        params: { changes },
        riskLevel: deleted ? 'destructive' : 'write',
        context: this.context,
      })
      return {
        decision:
          !this.cancelled &&
          result.behavior === 'allow' &&
          (await codexPatchStaysInWorkspace(changes, this.cwd))
            ? 'accept'
            : 'decline',
      }
    } else return { decision: 'decline' }
    const result = await this.toolHost.authorizeSdkTool({
      toolName,
      params: input,
      context: this.context,
      reason: text(params.reason),
      authorizationId: text(params.approvalId) || text(params.itemId),
    })
    return { decision: !this.cancelled && result.behavior === 'allow' ? 'accept' : 'decline' }
  }

  private emit(event: Record<string, unknown>): void {
    this.handler?.('stream', { protocol: 'studio-agent-event-v1', event })
  }
}
