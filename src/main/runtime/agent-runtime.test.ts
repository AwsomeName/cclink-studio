import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  AgentBridge: vi.fn(function AgentBridge() {
    return { invalidateBrowserScope: vi.fn() }
  }),
  initializeRuntime: vi.fn(async () => ({
    source: 'system',
    executablePath: '/resolved/claude',
    claudeCodeVersion: '2.1.211',
    sdkVersion: '0.3.211',
    fingerprint: 'a'.repeat(64),
    integrity: 'filesystem-probe',
    probedAt: 1,
  })),
}))

vi.mock('../agent/agent-bridge', () => ({ AgentBridge: mocks.AgentBridge }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cclink-studio-test' },
}))

import { createRuntimeState } from './app-runtime'
import { bootstrapAgentRuntime } from './agent-runtime'

describe('bootstrapAgentRuntime', () => {
  beforeEach(() => {
    mocks.AgentBridge.mockClear()
    mocks.initializeRuntime.mockClear()
  })

  it('starts the local Agent with a resolved runtime when Playwright and ADB are unavailable', async () => {
    const runtime = createRuntimeState(true)
    runtime.mainWindow = {} as never
    runtime.toolHost = {} as never
    runtime.permissionManager = {} as never
    runtime.mcpClientMgr = {} as never
    runtime.settingsService = {
      getRuntimeSettings: () => ({ agentEngine: 'local-claude-code' }),
      getAll: () => ({ lastWorkspacePath: '' }),
    } as never
    runtime.capabilities.ready('mcp')
    runtime.claudeRuntimeManager = {
      initialize: mocks.initializeRuntime,
      getStatus: () => ({ state: 'ready' }),
    } as never

    await bootstrapAgentRuntime(runtime)

    expect(mocks.AgentBridge).toHaveBeenCalledWith(
      runtime.mainWindow,
      null,
      runtime.toolHost,
      runtime.permissionManager,
      runtime.mcpClientMgr,
      null,
      expect.objectContaining({
        claudeCodePath: '/resolved/claude',
        runtimeProvenance: {
          source: 'system',
          sdkVersion: '0.3.211',
          claudeCodeVersion: '2.1.211',
        },
      }),
    )
    expect(mocks.initializeRuntime).toHaveBeenCalledWith({ source: 'system' })
    expect(runtime.capabilities.get('agent-backend').state).toBe('ready')
  })

  it('keeps the Agent unavailable when the MCP host failed', async () => {
    const runtime = createRuntimeState(true)
    runtime.mainWindow = {} as never
    runtime.toolHost = {} as never
    runtime.permissionManager = {} as never
    runtime.mcpClientMgr = {} as never
    runtime.settingsService = {} as never
    runtime.capabilities.failed('mcp', new Error('listen failed'))

    await bootstrapAgentRuntime(runtime)

    expect(mocks.AgentBridge).not.toHaveBeenCalled()
    expect(runtime.agentRuntimeStateStore).not.toBeNull()
    expect(runtime.capabilities.get('agent-backend')).toMatchObject({
      state: 'unavailable',
      reason: 'Agent 核心依赖未就绪',
    })
  })

  it('does not start a bundled runtime through Claude subscription login', async () => {
    const runtime = createRuntimeState(true)
    runtime.mainWindow = {} as never
    runtime.toolHost = {} as never
    runtime.permissionManager = {} as never
    runtime.mcpClientMgr = {} as never
    runtime.settingsService = {
      getRuntimeSettings: () => ({
        agentEngine: 'local-claude-code',
        claudeRuntimeSource: 'bundled',
        claudeCodePath: '',
        apiKey: '',
      }),
      getAll: () => ({ lastWorkspacePath: '' }),
    } as never
    const reportFailure = vi.fn()
    runtime.claudeRuntimeManager = {
      initialize: vi.fn(async () => ({
        source: 'bundled',
        executablePath: '/bundle/claude',
        claudeCodeVersion: '2.1.211',
        fingerprint: 'b'.repeat(64),
        integrity: 'manifest-sha256',
        probedAt: 1,
      })),
      reportFailure,
      getStatus: () => ({ state: 'degraded' }),
    } as never
    runtime.capabilities.ready('mcp')

    await bootstrapAgentRuntime(runtime)

    expect(mocks.AgentBridge).not.toHaveBeenCalled()
    expect(runtime.agentRuntimeStateStore).not.toBeNull()
    expect(reportFailure).toHaveBeenCalledWith({
      code: 'AUTH_REQUIRED',
      message: expect.stringContaining('不能使用 Claude 订阅登录'),
    })
    expect(runtime.capabilities.get('agent-backend')).toMatchObject({
      state: 'unavailable',
      reason: expect.stringContaining('AUTH_REQUIRED'),
    })
  })
})
