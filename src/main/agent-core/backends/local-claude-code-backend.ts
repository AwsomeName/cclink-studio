/**
 * LocalClaudeCodeBackend — 本机 Claude Code CLI 后端
 *
 * 通过 spawn('claude', ...) 子进程与 Claude Code CLI 交互。
 * 实现 IAgentBackend 接口。
 */

import { spawn, type ChildProcess } from 'child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import type { McpToolHost } from '../tools/tool-host.js'
import type { ToolDefinition } from '../tools/types.js'
import type {
  IAgentBackend,
  AgentBackendStatus,
  AgentEventHandler,
  AgentHostContext,
  AgentSendOptions,
} from './types.js'
import {
  DEFAULT_SCOPE,
  scopeToAllowedTools,
  filterToolsByScope,
  type AgentScope,
} from '../runtime/scope.js'

const DISALLOWED_CLAUDE_TOOLS = ['mcp__deepink__browser_new_tab', 'AskUserQuestion']
const DISALLOWED_TOOL_NAMES = new Set(['browser_new_tab'])

export interface McpConfigComposer {
  composeMcpConfig(internalPort: number, sessionToken?: string): Record<string, unknown>
}

export interface BrowserPageSnapshot {
  url(): string
}

export interface BrowserAutomationHost {
  getPage(): BrowserPageSnapshot | null
}

export interface AndroidAdbHost {
  getDeviceId(): string | null
  isConnected(): boolean
}

export interface ClaudeCodeBackendOptions {
  /** Claude Code CLI 绝对路径；为空时交给 spawn 按 PATH 解析。 */
  claudeCodePath?: string
  /** 单次会话最大费用（美元） */
  maxBudgetUsd?: number
  /** 注入到子进程的环境变量（如 ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY） */
  env?: Record<string, string>
  /** 获取当前工作区路径（用于把 Agent cwd 绑定到工作区；空串=未选，回退临时目录） */
  getWorkspacePath?: () => string
  /** agent-device 语义层是否可用（用于工具上下文 prompt 提示 Agent 何时用/降级） */
  agentDeviceAvailable?: () => boolean
  /** 宿主产品/工具上下文标签；避免 core 写死具体桌面产品。 */
  hostContext?: AgentHostContext
}

export class LocalClaudeCodeBackend implements IAgentBackend {
  private currentProcess: ChildProcess | null = null
  private sessionId: string | null = null
  private aborted = false
  private lastCliErrorMessage: string | null = null
  private stderrTail = ''
  /** MCP 配置临时目录路径（进程退出时清理） */
  private mcpConfigDir: string | null = null
  /** 当前 Claude Code 进程使用的 MCP 会话 token（进程退出时释放） */
  private mcpSessionToken: string | null = null
  private readonly maxBudgetUsd: number
  private readonly claudeCodePath: string
  private readonly extraEnv: Record<string, string>
  private readonly getWorkspacePath?: () => string
  private readonly toolHost: McpToolHost
  private readonly mcpClientMgr: McpConfigComposer
  private readonly playwrightBridge: BrowserAutomationHost
  private readonly adbBridge?: AndroidAdbHost
  private readonly agentDeviceAvailable?: () => boolean
  private readonly hostContext: Required<AgentHostContext>
  private eventHandler: AgentEventHandler | null = null
  /** 当前操作作用域（每次 sendMessage 读取，决定工具收窄 + prompt 聚焦） */
  private scope: AgentScope = DEFAULT_SCOPE

  constructor(
    playwrightBridge: BrowserAutomationHost,
    toolHost: McpToolHost,
    mcpClientMgr: McpConfigComposer,
    adbBridge: AndroidAdbHost,
    options?: ClaudeCodeBackendOptions,
  ) {
    this.playwrightBridge = playwrightBridge
    this.toolHost = toolHost
    this.mcpClientMgr = mcpClientMgr
    this.adbBridge = adbBridge
    this.claudeCodePath = options?.claudeCodePath?.trim() || 'claude'
    this.maxBudgetUsd = options?.maxBudgetUsd ?? 1.0
    this.extraEnv = options?.env ?? {}
    this.getWorkspacePath = options?.getWorkspacePath
    this.agentDeviceAvailable = options?.agentDeviceAvailable
    this.hostContext = {
      hostName: options?.hostContext?.hostName ?? 'Host application',
      mcpServerName: options?.hostContext?.mcpServerName ?? 'agent-tools',
      androidControllerName: options?.hostContext?.androidControllerName ?? 'host application',
    }
  }

  onEvent(handler: AgentEventHandler): void {
    this.eventHandler = handler
  }

  /** 设置操作作用域（下次 sendMessage 生效） */
  setScope(scope: AgentScope): void {
    this.scope = scope
  }

  /**
   * 清理 MCP 配置临时文件
   * 每轮 sendMessage 都写新的临时目录，需要在进程退出/中止/销毁时清理。
   */
  private cleanupMcpConfig(): void {
    if (this.mcpSessionToken) {
      this.toolHost.releaseToolSession(this.mcpSessionToken)
      this.mcpSessionToken = null
    }
    if (this.mcpConfigDir) {
      try {
        rmSync(this.mcpConfigDir, { recursive: true, force: true })
      } catch {
        // 临时文件清理失败不阻断流程
      }
      this.mcpConfigDir = null
    }
  }

  private emit(type: 'stream' | 'complete' | 'error' | 'system', data: unknown): void {
    this.eventHandler?.(type, data)
  }

  private buildProcessEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (
        key === 'ANTHROPIC_API_KEY' ||
        key === 'ANTHROPIC_AUTH_TOKEN' ||
        key === 'ANTHROPIC_BASE_URL'
      ) {
        delete env[key]
      } else if (key.startsWith('ANTHROPIC_DEFAULT_') || key.startsWith('ANTHROPIC_MODEL')) {
        delete env[key]
      } else if (key.startsWith('ANTHROPIC_SMALL_FAST_MODEL')) {
        delete env[key]
      } else if (/^CLAUDE_CODE_.*MODEL$/.test(key)) {
        delete env[key]
      }
    }
    return { ...env, ...this.extraEnv }
  }

  private rememberStderr(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-2000)
  }

  /** 动态构建工具上下文 prompt（按当前作用域聚焦：只列该域工具 + 该域状态/约定） */
  private buildToolContextPrompt(options?: AgentSendOptions): string {
    const scope = this.scope
    const forceVisibleBrowser = options?.forceVisibleBrowser === true
    const page = this.playwrightBridge.getPage()
    const connected = page !== null
    const currentUrl = page?.url() ?? 'about:blank'

    // 按作用域过滤工具表（all = 全部；其余只列该域）
    const scopedTools = filterToolsByScope(this.toolHost.getAllTools(), scope).filter(
      (tool) => !(forceVisibleBrowser && DISALLOWED_TOOL_NAMES.has(tool.name)),
    )

    const toolLines = scopedTools.map((tool: ToolDefinition) => {
      const params = Object.entries(tool.inputSchema.properties ?? {})
        .map(([key, schema]) => {
          const s = schema as { type?: string; description?: string }
          const required = tool.inputSchema.required?.includes(key)
          return `${key}: ${s.type ?? 'string'}${required ? '' : ' (可选)'}`
        })
        .join(', ')
      return `| ${tool.name} | ${tool.description} | ${params || '（无参数）'} |`
    })

    const sections: string[] = [
      `## ${this.hostContext.hostName} 工具环境`,
      '',
      `你运行在 ${this.hostContext.hostName} 提供的 Agent 环境内。用户已为你选定操作目标，请聚焦该目标操作。`,
      '',
      `### 当前操作作用域`,
      this.scopeHeader(scope),
      '',
    ]

    if (options?.resourceContext) {
      sections.push(
        '### CCLink Studio 资源事实包',
        '以下 JSON 是宿主采样的真实运行态。判断页面、目录、配置和任务目标时，以这里的 URL/host/workspace/config/task 为准；不要用搜索结果摘要或页面文案脑补已经进入目标站点。',
        '```json',
        JSON.stringify(options.resourceContext, null, 2),
        '```',
        '',
      )
    }

    // 浏览器状态 + 约定（browser / all）
    if (scope.kind === 'all' || scope.kind === 'browser') {
      sections.push(
        '### 当前浏览器状态',
        `- Playwright 连接: ${connected ? '✅ 已连接' : '❌ 未连接'}`,
        `- 当前页面 URL: ${currentUrl}`,
      )
      // browser scope 额外标注当前实例（all 不需要）
      if (scope.kind === 'browser') {
        sections.push(`- 🎯 当前操作目标实例: ${scope.instanceId}（用户已选定的浏览器 Tab）`)
      }
      sections.push(
        '',
        '### 使用建议',
        ...(forceVisibleBrowser
          ? [
              '- 用户已显式 @ 绑定浏览器 Tab 或选择浏览器 scope：必须操作 CCLink Studio 左侧可视浏览器页',
              '- 默认不要新开 Tab：先用 browser_navigate 在当前可视页打开目标 URL，再用 browser_fill / browser_click / browser_press 操作页面',
              '- 访问站点后必须用 browser_get_tab_info 或 browser_title 验证当前 URL/标题；只有 URL host 已匹配目标站点时，才能声称已经打开该站点或登录页',
              '- 如果当前 URL 仍是搜索引擎结果页，不要把搜索结果摘要、AI 摘要或页面文本当作目标站点内容；应继续直接 browser_navigate 到目标 URL、点击官方结果，或明确说明导航失败',
              '- 不要使用 Claude Code 内置 WebSearch/WebFetch 或其他不可见搜索；需要搜索时就在可视浏览器里的搜索引擎页面完成',
              '- 不要调用 AskUserQuestion；需要用户选择、输入验证码或手动操作时，直接用普通 assistant 文本向用户说明并停止等待',
              '- browser_new_tab 当前被禁用，因为它会创建不可见后台页；如确需多页，请提示用户手动新建可视浏览器 Tab',
            ]
          : [
              '- 用户显式要求操作页面，或 @ 挂载了浏览器 Tab 时，优先使用 browser_navigate / browser_fill / browser_click 等可视浏览器工具',
            ]),
        '- 操作前先用 browser_extract 或 browser_screenshot 了解当前页面状态',
        '- 使用 CSS 选择器定位元素（如 `#search`, `.btn-primary`, `[name="q"]`）',
        '- 填写表单时用 browser_fill，它会自动清空已有内容',
        '- 等待页面加载用 browser_wait_for_selector',
        '- 如果操作失败，可能需要先等待元素出现',
        '',
        '### 验证码和人机验证处理',
        '- 遇到验证码（CAPTCHA）、滑块验证、图形验证码时，不要尝试自动识别或绕过',
        '- 立即用 browser_screenshot 截图展示给用户，告诉用户遇到了验证码需要手动处理',
        '- 等待用户确认已处理验证码后，用 browser_screenshot 确认页面状态再继续操作',
        '',
        '### 文件上传',
        '- 使用 browser_upload_file 上传本地文件（照片、文档、代码压缩包等）',
        '- 需要提供文件输入框的 CSS 选择器和本地文件的绝对路径',
        '- 如果不知道文件路径，可以提示用户手动操作上传',
        '',
      )
    }

    // Android 真机状态 + 约定（android / all）
    if (scope.kind === 'all' || scope.kind === 'android') {
      const adbDeviceId = this.adbBridge?.getDeviceId() ?? null
      const adbConnected = this.adbBridge?.isConnected() ?? false
      sections.push(
        '### 当前 Android 真机状态',
        '- Android 模拟器 / 云手机路线已封存；只操作用户主动连接的 USB / Wi-Fi ADB 真机',
        `- ADB 设备号: ${adbDeviceId ?? '未连接'}${adbConnected ? '' : '（未连接）'}`,
        '',
        '### Android 操作约定',
        '- 不要启动、安装或管理 Android 模拟器；没有真机连接时，请提示用户到设备设置页连接手机',
        `- **不要自己 adb connect**；android_* 工具只会面向 ${this.hostContext.androidControllerName} 当前选中的真机`,
        '- 操控应用：android_tap / android_swipe / android_type_text / android_press_key',
        '- 看界面：android_screenshot / android_dump_ui；查设备用 android_device_info',
        '',
        '### Android UI 感知操作（agent-device 语义层，操控 App 时推荐优先）',
        `- ${this.hostContext.hostName} 集成 agent-device 语义层。操控 Android App 优先用语义工具，定位更稳：`,
        '- agent_device_snapshot：返回带 ref（如 @e3）的无障碍树，比 android_dump_ui 完整（含 WebView/Compose/系统浮层/键盘节点）',
        '- agent_device_click(ref 或 x/y)：用 ref 点击，元素轻微移动也能命中；无 ref 时接坐标',
        '- agent_device_type(text, ref?)：输入文本（ref 定位输入框，支持中文）',
        '- agent_device_swipe：滑动手势（坐标式）',
        '- ⚠️ ref 仅在下次 agent_device_snapshot 前有效。操作后界面若变，须重新 snapshot 获取新 ref',
        '- 何时退回坐标式（android_tap/android_swipe/android_type_text/android_dump_ui）：snapshot 抓不到的元素（游戏 Canvas/视频/动态绘制层）、ref 失效、或 agent-device 工具报错降级',
        this.agentDeviceAvailable?.() === false
          ? '- ⚠️ agent-device 当前不可用（库未加载/daemon 异常/真机未连），请直接用 android_dump_ui + android_tap 坐标操作或提示用户连接真机'
          : '- 当前 agent-device 可用 ✅',
        '',
      )
    }

    // 编辑器约定（editor / all）
    if (scope.kind === 'all' || scope.kind === 'editor') {
      sections.push(
        '### 编辑器使用',
        '- 用户让你写文档、报告、笔记时，用 editor_write 将 Markdown 写入编辑器',
        '- 逐步构建文档时用 editor_append 追加内容',
        '- 编辑器支持完整 Markdown：标题、粗体、代码块、表格、列表、任务列表等',
        '',
      )
    }

    // 工具表（已按作用域过滤）
    sections.push(
      `### 可用工具（MCP server: ${this.hostContext.mcpServerName}，当前作用域内 ${scopedTools.length} 个）`,
      '',
      '| 工具 | 用途 | 参数 |',
      '|------|------|------|',
      ...toolLines,
    )

    return sections.join('\n')
  }

  /** 作用域头部说明（告诉 Agent 当前聚焦什么、何时跨域） */
  private scopeHeader(scope: AgentScope): string {
    switch (scope.kind) {
      case 'all':
        return '- 🤖 **全部**：可操作浏览器、Android、编辑器。跨域任务（如「把网页内容整理进文档」）请正常完成。'
      case 'browser':
        return `- 🌐 **浏览器实例 ${scope.instanceId}**：本次任务聚焦操作该浏览器 Tab。只列出了 browser_* 工具；如需写文档/操作手机，提示用户切换作用域。`
      case 'android':
        return '- 📱 **Android**：本次任务聚焦操作用户已连接的 Android 真机。只列出了 android_* / agent_device_* 工具；如需操作浏览器/编辑器，提示用户切换作用域。'
      case 'editor':
        return '- 📄 **编辑器**：本次任务聚焦 Markdown 编辑器。只列出了 editor_* 工具；如需操作浏览器/手机，提示用户切换作用域。'
    }
  }

  async sendMessage(userMessage: string, options?: AgentSendOptions): Promise<void> {
    // 如果上一轮还在运行，拒绝新消息
    if (this.currentProcess && !this.currentProcess.killed) {
      this.emit('error', {
        type: 'error',
        message: 'AI 正在响应中，请等待完成或点击中止',
      })
      return
    }

    this.aborted = false
    this.lastCliErrorMessage = null
    this.stderrTail = ''

    // 构建 CLI 参数
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--max-budget-usd',
      String(this.maxBudgetUsd),
    ]
    if (options?.forceVisibleBrowser) {
      args.push(
        '--tools',
        '',
        '--strict-mcp-config',
        '--disallowedTools',
        DISALLOWED_CLAUDE_TOOLS.join(' '),
      )
    }

    // 合成 MCP 配置（写临时文件而非内联 JSON：CLI 当前版本对内联 JSON 解析有问题）
    this.mcpSessionToken = this.toolHost.createToolSession(
      options?.conversationId ?? 'agent-default',
    )
    const mcpConfig = this.mcpClientMgr.composeMcpConfig(
      this.toolHost.getPort(),
      this.mcpSessionToken,
    )
    this.mcpConfigDir = mkdtempSync(join(tmpdir(), 'deepink-mcp-'))
    const mcpConfigFile = join(this.mcpConfigDir, 'mcp-config.json')
    writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2))
    args.push('--mcp-config', mcpConfigFile)
    // 工具收窄：按当前作用域决定 allowedTools（all=全部；其余只暴露该域）。
    // 服务端照常广播全部工具，CLI 客户端 allowlist 只把匹配的暴露给模型。
    for (const glob of scopeToAllowedTools(this.scope)) {
      args.push('--allowedTools', glob)
    }

    // 绑定工作区：把 Agent 的 cwd 锁到用户工作区，并通过 --add-dir 显式授权该目录
    // （未选工作区时回退到系统临时目录，避免 Agent 在主进程目录随意操作）
    const workspacePath = this.getWorkspacePath?.() ?? ''
    if (workspacePath) {
      args.push('--add-dir', workspacePath)
    }

    // 动态注入工具上下文
    args.push('--append-system-prompt', this.buildToolContextPrompt(options))

    // 有 session 时恢复对话
    if (this.sessionId) {
      args.push('--resume', this.sessionId)
    }

    // 用户消息放最后
    args.push(userMessage)

    try {
      this.currentProcess = spawn(this.claudeCodePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.buildProcessEnv(),
        cwd: workspacePath || tmpdir(),
      })
    } catch (err) {
      this.cleanupMcpConfig()
      this.emit('error', {
        type: 'error',
        message: `无法启动 Claude Code CLI: ${String(err)}`,
      })
      return
    }

    const proc = this.currentProcess
    proc.stdin?.end()

    // stderr 日志
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      this.rememberStderr(text)
      console.error('[ClaudeCodeBackend] stderr:', text)
    })

    // 逐行解析 stdout NDJSON
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line: string) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        this.handleEvent(event)
      } catch {
        console.warn('[ClaudeCodeBackend] 无法解析 NDJSON 行:', line.slice(0, 100))
      }
    })

    // 进程退出处理
    proc.on('exit', (code, signal) => {
      if (!this.aborted && code !== 0 && code !== null && !this.lastCliErrorMessage) {
        const detail = this.stderrTail.trim()
        this.emit('error', {
          type: 'error',
          message: detail
            ? `Claude Code 进程异常退出 (code: ${code}, signal: ${signal}): ${detail}`
            : `Claude Code 进程异常退出 (code: ${code}, signal: ${signal})`,
        })
      }
      this.currentProcess = null
      this.cleanupMcpConfig()
    })

    // 进程错误处理
    proc.on('error', (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `Claude Code CLI 未找到（${this.claudeCodePath}）。请在设置页检测或手动填写路径。`
          : `Claude Code CLI 错误: ${err.message}`

      this.emit('error', { type: 'error', message })
      this.currentProcess = null
      this.cleanupMcpConfig()
    })
  }

  /** 解析 CLI 事件并 emit */
  private handleEvent(event: Record<string, unknown>): void {
    const type = event.type as string

    switch (type) {
      case 'system': {
        if (event.subtype === 'init' && event.session_id) {
          this.sessionId = event.session_id as string
        }
        this.emit('system', event)
        break
      }
      case 'stream_event':
      case 'assistant':
      case 'tool_progress':
        this.emit('stream', event)
        break
      case 'result':
        if (event.is_error === true) {
          const errors = Array.isArray(event.errors)
            ? event.errors.filter((item): item is string => typeof item === 'string')
            : []
          const message =
            typeof event.result === 'string' && event.result.trim()
              ? event.result
              : errors.length > 0
                ? errors.join('\n')
                : 'Claude Code 返回错误结果'
          this.lastCliErrorMessage = message
          this.emit('error', { type: 'error', message })
        } else {
          this.emit('complete', event)
        }
        break
      default:
        this.emit('stream', event)
        break
    }
  }

  async abort(): Promise<void> {
    this.aborted = true
    if (this.currentProcess && !this.currentProcess.killed) {
      this.currentProcess.kill('SIGTERM')
      this.currentProcess = null
    }
    this.cleanupMcpConfig()
  }

  getStatus(): AgentBackendStatus {
    return {
      connected: this.currentProcess !== null && !this.currentProcess.killed,
      sessionId: this.sessionId,
    }
  }

  resetSession(): void {
    this.sessionId = null
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId
  }

  async destroy(): Promise<void> {
    await this.abort()
    this.eventHandler = null
  }
}
