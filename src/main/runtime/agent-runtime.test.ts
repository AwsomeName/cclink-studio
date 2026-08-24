import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  AgentBridge: vi.fn(function AgentBridge() {
    return { destroy: mocks.destroy, invalidateBrowserScope: vi.fn() }
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
  startCclinkAgent: vi.fn(async () => ({
    baseUrl: 'http://127.0.0.1:17374',
    token: 'mock:test:runtime:run:/workspace',
    runtimeId: 'claude_code',
  })),
  stopCclinkAgent: vi.fn(async () => undefined),
}))

vi.mock('../agent/agent-bridge', () => ({ AgentBridge: mocks.AgentBridge }))
vi.mock('../agent/cclink-agent-service', () => ({
  CclinkAgentService: vi.fn(function CclinkAgentService() {
    return { start: mocks.startCclinkAgent, stop: mocks.stopCclinkAgent }
  }),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cclink-studio-test' },
}))

import { createRuntimeState } from './app-runtime'
import { bootstrapAgentRuntime, shutdownAgentRuntime } from './agent-runtime'

describe('bootstrapAgentRuntime', () => {
  beforeEach(() => {
    mocks.AgentBridge.mockClear()
    mocks.destroy.mockClear()
    mocks.initializeRuntime.mockClear()
    mocks.startCclinkAgent.mockClear()
    mocks.stopCclinkAgent.mockClear()
    delete process.env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  })

  it('does not wait for active Agent runs during explicit App shutdown', async () => {
    const runtime = createRuntimeState(true)
    runtime.agentBridge = { destroy: mocks.destroy } as never

    await shutdownAgentRuntime(runtime)

    expect(mocks.destroy).toHaveBeenCalledWith({ waitForActiveRuns: false })
    expect(runtime.agentBridge).toBeNull()
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

  it('starts the explicit cclink-agent service without resolving Claude or requiring CCLink login', async () => {
    process.env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND = 'cclink-agent'
    const runtime = createRuntimeState(true)
    runtime.mainWindow = {} as never
    runtime.toolHost = {} as never
    runtime.permissionManager = {} as never
    runtime.mcpClientMgr = {} as never
    runtime.settingsService = {
      getRuntimeSettings: () => ({
        agentEngine: 'local-claude-code',
        lastWorkspacePath: '/workspace',
      }),
      getAll: () => ({ lastWorkspacePath: '/workspace' }),
    } as never
    runtime.capabilities.ready('mcp')

    await bootstrapAgentRuntime(runtime)

    expect(mocks.startCclinkAgent).toHaveBeenCalledTimes(1)
    expect(mocks.initializeRuntime).not.toHaveBeenCalled()
    expect(mocks.AgentBridge).toHaveBeenCalledWith(
      runtime.mainWindow,
      null,
      runtime.toolHost,
      runtime.permissionManager,
      runtime.mcpClientMgr,
      null,
      expect.objectContaining({
        experimentalCclinkAgent: expect.objectContaining({
          baseUrl: 'http://127.0.0.1:17374',
          runtimeId: 'claude_code',
        }),
      }),
    )
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
