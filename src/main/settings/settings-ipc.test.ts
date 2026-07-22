import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { registerSettingsIpc } from './settings-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}))

describe('registerSettingsIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('rejects an untrusted sender before settings are read', () => {
    const settingsService = createSettingsService()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
    )

    const handler = mockIpcMain.handlers.get('settings:getAll')
    expect(() => handler?.({ sender: 'other' })).toThrow('untrusted')
    expect(settingsService.getAll).not.toHaveBeenCalled()
  })

  it('rejects invalid settings before persistence', async () => {
    const settingsService = createSettingsService()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { permissionMode: 'unrestricted' }),
    ).resolves.toEqual({ success: false, error: '设置参数无效' })
    expect(settingsService.set).not.toHaveBeenCalled()
  })

  it('persists a valid bounded settings update', async () => {
    const settingsService = createSettingsService()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { permissionMode: 'strict', editorTabSize: 4 }),
    ).resolves.toMatchObject({ success: true })
    expect(settingsService.set).toHaveBeenCalledWith({
      permissionMode: 'strict',
      editorTabSize: 4,
    })
  })

  it('probes a runtime before persistence and commits the verified candidate', async () => {
    const settingsService = createSettingsService()
    settingsService.getRuntimeSettings.mockReturnValue({ ...DEFAULT_SETTINGS, apiKey: 'test-key' })
    const bridge = createAgentBridge()
    const resolvedRuntime = {
      source: 'bundled',
      executablePath: '/bundle/claude',
      claudeCodeVersion: '2.1.211',
      sdkVersion: '0.3.211',
      fingerprint: 'a'.repeat(64),
      integrity: 'manifest-sha256',
      probedAt: 1,
    }
    const runtimeManager = {
      probe: vi.fn(async () => ({ success: true, runtime: resolvedRuntime })),
      commit: vi.fn(),
      getStatus: vi.fn(() => ({ active: resolvedRuntime })),
    }
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
      () => null,
      () => runtimeManager as never,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { claudeRuntimeSource: 'bundled' }),
    ).resolves.toMatchObject({ success: true })

    expect(runtimeManager.probe).toHaveBeenCalledWith({ source: 'bundled' })
    expect(settingsService.set).toHaveBeenCalledWith({
      claudeRuntimeSource: 'bundled',
      claudeCodePath: '',
    })
    expect(runtimeManager.commit).toHaveBeenCalledWith({ source: 'bundled' }, resolvedRuntime)
    expect(bridge.reconfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeCodePath: '/bundle/claude',
        runtimeProvenance: {
          source: 'bundled',
          sdkVersion: '0.3.211',
          claudeCodeVersion: '2.1.211',
        },
      }),
      { forceResetSessions: false },
    )
    expect(bridge.endConfigurationChange).toHaveBeenCalled()
  })

  it('does not persist a runtime candidate that fails its probe', async () => {
    const settingsService = createSettingsService()
    settingsService.getRuntimeSettings.mockReturnValue({ ...DEFAULT_SETTINGS, apiKey: 'test-key' })
    const bridge = createAgentBridge()
    const runtimeManager = {
      probe: vi.fn(async () => ({
        success: false,
        failure: { code: 'BUNDLED_RUNTIME_MISSING', message: 'missing' },
      })),
    }
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
      () => null,
      () => runtimeManager as never,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { claudeRuntimeSource: 'bundled' }),
    ).resolves.toEqual({
      success: false,
      error: 'BUNDLED_RUNTIME_MISSING: missing',
    })
    expect(settingsService.set).not.toHaveBeenCalled()
    expect(bridge.reconfigure).not.toHaveBeenCalled()
    expect(bridge.endConfigurationChange).toHaveBeenCalled()
  })

  it('rejects bundled mode without an explicit API credential before probing', async () => {
    const settingsService = createSettingsService()
    const bridge = createAgentBridge()
    const runtimeManager = { probe: vi.fn() }
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
      () => null,
      () => runtimeManager as never,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { claudeRuntimeSource: 'bundled' }),
    ).resolves.toEqual({
      success: false,
      error: expect.stringContaining('AUTH_REQUIRED'),
    })
    expect(runtimeManager.probe).not.toHaveBeenCalled()
    expect(settingsService.set).not.toHaveBeenCalled()
    expect(bridge.endConfigurationChange).toHaveBeenCalled()
  })

  it('rejects Agent configuration changes while any conversation is running', async () => {
    const settingsService = createSettingsService()
    const bridge = createAgentBridge(false)
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(handler?.({ sender: 'trusted' }, { modelName: 'next-model' })).resolves.toEqual({
      success: false,
      error: expect.stringContaining('RUNTIME_SWITCH_PENDING'),
    })
    expect(settingsService.set).not.toHaveBeenCalled()
  })

  it('recovers the Agent in place after a valid setting change when no bridge is active', async () => {
    const settingsService = createSettingsService()
    const recoverAgentRuntime = vi.fn(async () => undefined)
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => null,
      recoverAgentRuntime,
    )

    const handler = mockIpcMain.handlers.get('settings:set')
    await expect(
      handler?.({ sender: 'trusted' }, { modelName: 'next-model' }),
    ).resolves.toMatchObject({ success: true })
    expect(recoverAgentRuntime).toHaveBeenCalledOnce()
  })

  it('tests the selected runtime with the encrypted API settings without exposing the key', async () => {
    const settingsService = createSettingsService()
    settingsService.getRuntimeSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      apiFormat: 'anthropic',
      apiBaseUrl: 'https://example.com/anthropic',
      apiKey: 'encrypted-key',
      modelName: 'claude-test',
    })
    const resolvedRuntime = {
      source: 'bundled',
      executablePath: '/bundle/claude',
      claudeCodeVersion: '2.1.211',
      sdkVersion: '0.3.211',
      fingerprint: 'a'.repeat(64),
      integrity: 'manifest-sha256',
      probedAt: 1,
    }
    const runtimeManager = {
      probe: vi.fn(async () => ({ success: true, runtime: resolvedRuntime })),
    }
    const runConnectionTest = vi.fn(async () => ({
      success: true as const,
      message: '连接成功',
      model: 'claude-test',
      durationMs: 120,
    }))
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => runtimeManager as never,
      async () => undefined,
      runConnectionTest,
    )

    const handler = mockIpcMain.handlers.get('settings:testClaudeModelConnection')
    await expect(handler?.({ sender: 'trusted' }, { source: 'bundled' })).resolves.toEqual({
      success: true,
      result: {
        success: true,
        message: '连接成功',
        model: 'claude-test',
        durationMs: 120,
      },
    })
    expect(runtimeManager.probe).toHaveBeenCalledWith({ source: 'bundled' })
    expect(runConnectionTest).toHaveBeenCalledWith({
      runtime: resolvedRuntime,
      apiFormat: 'anthropic',
      apiBaseUrl: 'https://example.com/anthropic',
      apiKey: 'encrypted-key',
      modelName: 'claude-test',
    })
  })

  it('rejects a model connection test before runtime launch when no API key is saved', async () => {
    const settingsService = createSettingsService()
    const runtimeManager = { probe: vi.fn() }
    const runConnectionTest = vi.fn()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => runtimeManager as never,
      async () => undefined,
      runConnectionTest,
    )

    const handler = mockIpcMain.handlers.get('settings:testClaudeModelConnection')
    await expect(handler?.({ sender: 'trusted' }, { source: 'system' })).resolves.toEqual({
      success: true,
      result: {
        success: false,
        code: 'AUTH_REQUIRED',
        message: '请先保存 API Key，再测试连接。',
        durationMs: 0,
      },
    })
    expect(runtimeManager.probe).not.toHaveBeenCalled()
    expect(runConnectionTest).not.toHaveBeenCalled()
  })

  it('allows only one model connection test at a time', async () => {
    const settingsService = createSettingsService()
    settingsService.getRuntimeSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      apiKey: 'encrypted-key',
      modelName: 'claude-test',
    })
    const resolvedRuntime = {
      source: 'system',
      executablePath: '/usr/local/bin/claude',
      claudeCodeVersion: '2.1.211',
      sdkVersion: '0.3.211',
      fingerprint: 'a'.repeat(64),
      integrity: 'version-probe',
      probedAt: 1,
    }
    const runtimeManager = {
      probe: vi.fn(async () => ({ success: true, runtime: resolvedRuntime })),
    }
    let finishTest: (() => void) | undefined
    const runConnectionTest = vi.fn(
      () =>
        new Promise<{
          success: true
          message: string
          model: string
          durationMs: number
        }>((resolve) => {
          finishTest = () =>
            resolve({
              success: true,
              message: '连接成功',
              model: 'claude-test',
              durationMs: 120,
            })
        }),
    )
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => runtimeManager as never,
      async () => undefined,
      runConnectionTest,
    )

    const handler = mockIpcMain.handlers.get('settings:testClaudeModelConnection')
    const firstTest = handler?.({ sender: 'trusted' }, { source: 'system' })
    await vi.waitFor(() => expect(runConnectionTest).toHaveBeenCalledOnce())
    await expect(handler?.({ sender: 'trusted' }, { source: 'system' })).resolves.toEqual({
      success: false,
      error: '模型连接测试正在进行，请等待当前测试完成',
    })
    finishTest?.()
    await expect(firstTest).resolves.toMatchObject({ success: true })
  })
})

function createSettingsService() {
  return {
    getAll: vi.fn(() => ({ ...DEFAULT_SETTINGS })),
    getRuntimeSettings: vi.fn(() => ({ ...DEFAULT_SETTINGS })),
    getSecretStatus: vi.fn(),
    setSecret: vi.fn(),
    clearSecret: vi.fn(),
    set: vi.fn(async (partial) => ({ ...DEFAULT_SETTINGS, ...partial })),
    reset: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    resetKey: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
  }
}

function createPermissionManager() {
  return { setMode: vi.fn() }
}

function createAgentBridge(lockAvailable = true) {
  return {
    beginConfigurationChange: vi.fn(() => lockAvailable),
    endConfigurationChange: vi.fn(),
    reconfigure: vi.fn(),
  }
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
