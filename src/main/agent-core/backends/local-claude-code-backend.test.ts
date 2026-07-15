import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import type { McpToolHost } from '../tools/tool-host'
import type { ToolDefinition } from '../tools/types'
import {
  LocalClaudeCodeBackend,
  type BrowserAutomationHost,
  type McpConfigComposer,
} from './local-claude-code-backend'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess
  proc.stdin = new PassThrough()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  Object.defineProperty(proc, 'killed', { value: false })
  return proc
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  }
}

function createBackendFixture(): {
  backend: LocalClaudeCodeBackend
  createToolSession: ReturnType<typeof vi.fn>
  releaseToolSession: ReturnType<typeof vi.fn>
  composeMcpConfig: ReturnType<typeof vi.fn>
} {
  const playwrightBridge: BrowserAutomationHost = {
    getPage: () => ({ url: () => 'https://www.baidu.com/' }),
  }
  const createToolSession = vi.fn(() => 'mcp-session-1')
  const releaseToolSession = vi.fn()
  const toolHost = {
    getPort: () => 39876,
    createToolSession,
    releaseToolSession,
    getAllTools: () => [
      createTool('browser_navigate'),
      createTool('browser_new_tab'),
      createTool('editor_write'),
    ],
  } as unknown as McpToolHost
  const composeMcpConfig = vi.fn((internalPort: number, sessionToken?: string) => {
    const url = new URL(`http://127.0.0.1:${internalPort}/mcp`)
    if (sessionToken) url.searchParams.set('session', sessionToken)
    return {
      mcpServers: {
        deepink: { type: 'http', url: url.toString() },
      },
    }
  })
  const mcpClientMgr = {
    composeMcpConfig,
  } satisfies McpConfigComposer

  const backend = new LocalClaudeCodeBackend(
    playwrightBridge,
    toolHost,
    mcpClientMgr,
    undefined as never,
    {
      claudeCodePath: '/usr/local/bin/claude',
      hostContext: {
        hostName: 'DeepInk',
        mcpServerName: 'deepink',
        androidControllerName: 'DeepInk',
      },
    },
  )

  return { backend, createToolSession, releaseToolSession, composeMcpConfig }
}

function createBackend(): LocalClaudeCodeBackend {
  return createBackendFixture().backend
}

function getLastSpawnArgs(): string[] {
  const call = spawnMock.mock.calls.at(-1)
  if (!call) throw new Error('spawn was not called')
  return call[1] as string[]
}

function getPrompt(args: string[]): string {
  const index = args.indexOf('--append-system-prompt')
  if (index < 0) throw new Error('append system prompt was not passed')
  return args[index + 1]
}

describe('LocalClaudeCodeBackend visible browser policy', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => createMockProcess())
  })

  it('keeps Claude Code built-in tools available for ordinary messages', async () => {
    await createBackend().sendMessage('普通问答')

    const args = getLastSpawnArgs()
    expect(args).not.toContain('--tools')
    expect(args).not.toContain('--strict-mcp-config')
    expect(args).not.toContain('--disallowedTools')
    expect(getPrompt(args)).toContain('| browser_new_tab |')
  })

  it('disables invisible browser routes when a visible browser tab is forced', async () => {
    await createBackend().sendMessage('操作这个网页', { forceVisibleBrowser: true })

    const args = getLastSpawnArgs()
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
      '--tools',
      '',
    ])
    expect(args).toContain('--strict-mcp-config')
    expect(
      args.slice(args.indexOf('--disallowedTools'), args.indexOf('--disallowedTools') + 2),
    ).toEqual(['--disallowedTools', 'mcp__deepink__browser_new_tab AskUserQuestion'])

    const prompt = getPrompt(args)
    expect(prompt).toContain('不要使用 Claude Code 内置 WebSearch/WebFetch')
    expect(prompt).toContain('只有 URL host 已匹配目标站点时')
    expect(prompt).toContain('不要调用 AskUserQuestion')
    expect(prompt).not.toContain('| browser_new_tab |')
  })

  it('binds MCP tool sessions to the current conversation', async () => {
    const { backend, createToolSession, releaseToolSession, composeMcpConfig } =
      createBackendFixture()

    await backend.sendMessage('操作当前会话', { conversationId: 'conv-123' })

    expect(createToolSession).toHaveBeenCalledWith('conv-123')
    expect(composeMcpConfig).toHaveBeenCalledWith(39876, 'mcp-session-1')

    const proc = spawnMock.mock.results.at(-1)?.value as EventEmitter
    proc.emit('exit', 0, null)
    expect(releaseToolSession).toHaveBeenCalledWith('mcp-session-1')
  })

  it('injects the host resource context into the system prompt', async () => {
    await createBackend().sendMessage('登录我的知乎', {
      resourceContext: {
        version: 1,
        generatedAt: 1,
        scope: { kind: 'all' },
        activeBrowser: {
          tabId: 'tab-1',
          isVisible: true,
          url: 'https://www.baidu.com/s?wd=知乎',
          host: 'www.baidu.com',
          title: '知乎_百度搜索',
          profile: 'default',
          viewState: { viewMode: 'desktop', zoomMode: 'fit', zoomFactor: 1 },
          suspectedChallenges: [],
          consoleIssueCount: 0,
          networkIssueCount: 0,
        },
        workspace: {
          ref: { kind: 'local', path: '/Users/apple/Desktop/woniu-forward' },
          key: '/Users/apple/Desktop/woniu-forward',
          rootPath: '/Users/apple/Desktop/woniu-forward',
          writable: true,
        },
        config: {
          permissionMode: 'auto',
          agentEngine: 'local-claude-code',
          defaultBrowserViewMode: 'desktop',
          defaultBrowserZoomMode: 'fit',
        },
        task: {
          kind: 'browser_login',
          confidence: 'high',
          targetSite: 'zhihu',
          expectedHosts: ['www.zhihu.com', 'zhihu.com'],
          preferredUrl: 'https://www.zhihu.com/signin',
          reason: '用户要求登录 zhihu',
        },
        mountedResourceIds: [],
        notes: ['当前浏览器 host 与任务目标 host 不一致；禁止声称已经打开目标站点。'],
      },
    })

    const prompt = getPrompt(getLastSpawnArgs())
    expect(prompt).toContain('### DeepInk 资源事实包')
    expect(prompt).toContain('"host": "www.baidu.com"')
    expect(prompt).toContain('"expectedHosts"')
    expect(prompt).toContain('以这里的 URL/host/workspace/config/task 为准')
  })
})
