import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { activateInstalledManagedClaude, registerSettingsIpc } from './settings-ipc'
import { registerCredentialsIpc } from '../credentials/credentials-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: () => '/test-user-data' },
}))

describe('registerSettingsIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('blocks advanced Agent credential mutations while a run owns the configuration', async () => {
    const bridge = createAgentBridge(false)
    const mutate = registerSettingsIpc(
      createSettingsService() as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
    )
    const credentials = {
      setCredential: vi.fn(),
      removeCredential: vi.fn(),
      clearAll: vi.fn(),
      reload: vi.fn(),
    }
    registerCredentialsIpc(credentials as never, createGuard('trusted') as never, mutate)
    for (const [channel, ...args] of [
      ['credentials:remove', 'agent:default'],
      ['credentials:remove', 'agent:acp:codex'],
      [
        'credentials:set',
        { id: 'agent:default', kind: 'api-key', fields: { apiKey: 'replacement' } },
      ],
      ['credentials:clearAll'],
      ['credentials:reload'],
    ]) {
      await expect(
        mockIpcMain.handlers.get(channel as string)!({ sender: 'trusted' }, ...args),
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('RUNTIME_SWITCH_PENDING'),
      })
    }
    for (const mutation of Object.values(credentials)) expect(mutation).not.toHaveBeenCalled()
    await mockIpcMain.handlers.get('credentials:remove')!(
      { sender: 'trusted' },
      'extension:meshy:default',
    )
    expect(credentials.removeCredential).toHaveBeenCalledWith('extension:meshy:default')
  })

  it.each(['credentials:remove', 'credentials:clearAll', 'credentials:reload'])(
    'invalidates the live backend after %s, including a damaged reload',
    async (channel) => {
      let key = 'previous-key'
      const service = createSettingsService()
      service.getRuntimeSettings.mockImplementation(() => ({ ...DEFAULT_SETTINGS, apiKey: key }))
      const bridge = createAgentBridge()
      const mutate = registerSettingsIpc(
        service as never,
        createGuard('trusted') as never,
        createPermissionManager() as never,
        () => bridge as never,
      )
      const change = vi.fn(async () => {
        key = ''
        return {
          status: channel === 'credentials:reload' ? 'degraded' : 'ready',
          configuredCount: 0,
          filePath: '/test/credentials.json',
          legacyEncryptedFiles: [],
          message: 'damaged file',
        }
      })
      registerCredentialsIpc(
        { removeCredential: change, clearAll: change, reload: change } as never,
        createGuard('trusted') as never,
        mutate,
      )
      const result = await mockIpcMain.handlers.get(channel)!(
        { sender: 'trusted' },
        ...(channel === 'credentials:remove' ? ['agent:default'] : []),
      )
      expect(result.success).toBe(channel !== 'credentials:reload')
      expect(bridge.reconfigure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }), {
        forceResetSessions: true,
      })
      expect(bridge.endConfigurationChange).toHaveBeenCalledOnce()
    },
  )

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

  it('bounds connection saves and rejects a busy Agent before changing credentials', async () => {
    const service = {
      ...createSettingsService(),
      saveClaudeConnection: vi.fn(async () => DEFAULT_SETTINGS),
    }
    const bridge = createAgentBridge(false)
    registerSettingsIpc(
      service as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
    )
    const handler = mockIpcMain.handlers.get('settings:saveClaudeConnection')!
    const input = {
      provider: 'custom',
      apiBaseUrl: 'https://models.example',
      modelName: 'test',
      apiKey: 'secret',
    }
    await expect(
      handler({ sender: 'trusted' }, { ...input, permissionMode: 'auto' }),
    ).resolves.toMatchObject({ success: false })
    await expect(
      handler({ sender: 'trusted' }, { ...input, apiBaseUrl: 'file:///tmp/key' }),
    ).resolves.toMatchObject({ success: false })
    await expect(handler({ sender: 'trusted' }, input)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('RUNTIME_SWITCH_PENDING'),
    })
    expect(service.saveClaudeConnection).not.toHaveBeenCalled()
  })

  it('reports a saved connection separately from runtime activation failure', async () => {
    const service = {
      ...createSettingsService(),
      saveClaudeConnection: vi.fn(async () => ({ ...DEFAULT_SETTINGS, modelName: 'test' })),
    }
    registerSettingsIpc(
      service as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => null,
      async () => {
        throw new Error('runtime missing')
      },
    )
    const handler = mockIpcMain.handlers.get('settings:saveClaudeConnection')!
    await expect(
      handler(
        { sender: 'trusted' },
        {
          provider: 'custom',
          apiBaseUrl: 'https://models.example',
          modelName: 'test',
          apiKey: 'secret',
        },
      ),
    ).resolves.toMatchObject({
      success: true,
      runtimeWarning: expect.stringContaining('运行环境尚未就绪'),
    })
  })

  it('does not hide a live backend reconfiguration failure behind a successful save', async () => {
    const service = {
      ...createSettingsService(),
      saveClaudeConnection: vi.fn(async () => DEFAULT_SETTINGS),
    }
    const bridge = createAgentBridge()
    bridge.reconfigure.mockImplementation(() => {
      throw new Error('backend unavailable')
    })
    registerSettingsIpc(
      service as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => bridge as never,
    )
    await expect(
      mockIpcMain.handlers.get('settings:saveClaudeConnection')?.(
        { sender: 'trusted' },
        {
          provider: 'custom',
          apiBaseUrl: 'https://models.example',
          modelName: 'test',
          apiKey: 'secret',
        },
      ),
    ).resolves.toMatchObject({
      success: true,
      runtimeWarning: expect.stringContaining('运行环境尚未就绪'),
    })
    expect(bridge.endConfigurationChange).toHaveBeenCalledOnce()
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

  it('does not let the renderer mutate the main-process workspace binding through settings', async () => {
    const settingsService = createSettingsService()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
    )

    await expect(
      mockIpcMain.handlers.get('settings:set')?.(
        { sender: 'trusted' },
        { lastWorkspacePath: '/tmp/other-project' },
      ),
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

  it('does not change or reset permission mode while a native run still owns its policy', async () => {
    const settingsService = createSettingsService()
    const permissionManager = createPermissionManager()
    const bridge = createAgentBridge(false)
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      permissionManager as never,
      () => bridge as never,
    )
    for (const [channel, payload] of [
      ['settings:set', { permissionMode: 'strict' }],
      ['settings:resetKey', 'permissionMode'],
    ] as const) {
      await expect(
        mockIpcMain.handlers.get(channel)?.({ sender: 'trusted' }, payload),
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('RUNTIME_SWITCH_PENDING'),
      })
    }
    expect(settingsService.set).not.toHaveBeenCalled()
    expect(settingsService.resetKey).not.toHaveBeenCalled()
    expect(permissionManager.setMode).not.toHaveBeenCalled()
  })

  it('applies persisted app zoom changes for set and reset paths', async () => {
    const settingsService = createSettingsService()
    const applyAppZoomLevel = vi.fn()
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => null,
      async () => undefined,
      applyAppZoomLevel,
    )

    await mockIpcMain.handlers.get('settings:set')?.({ sender: 'trusted' }, { appZoomLevel: -1 })
    await mockIpcMain.handlers.get('settings:reset')?.({ sender: 'trusted' })
    await mockIpcMain.handlers.get('settings:resetKey')?.({ sender: 'trusted' }, 'appZoomLevel')

    expect(applyAppZoomLevel).toHaveBeenNthCalledWith(1, -1)
    expect(applyAppZoomLevel).toHaveBeenNthCalledWith(2, DEFAULT_SETTINGS.appZoomLevel)
    expect(applyAppZoomLevel).toHaveBeenNthCalledWith(3, DEFAULT_SETTINGS.appZoomLevel)
  })

  it('applies the persisted update track immediately', async () => {
    const settingsService = createSettingsService()
    const applyUpdateTrack = vi.fn(async () => undefined)
    registerSettingsIpc(
      settingsService as never,
      createGuard('trusted') as never,
      createPermissionManager() as never,
      () => null,
      () => null,
      () => null,
      async () => undefined,
      () => undefined,
      undefined,
      applyUpdateTrack,
    )

    await mockIpcMain.handlers.get('settings:set')?.({ sender: 'trusted' }, { updateTrack: 'beta' })
    await mockIpcMain.handlers.get('settings:resetKey')?.({ sender: 'trusted' }, 'updateTrack')

    expect(applyUpdateTrack).toHaveBeenNthCalledWith(1, 'beta')
    expect(applyUpdateTrack).toHaveBeenNthCalledWith(2, 'stable')
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
      claudeManagedVersion: '',
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
      () => undefined,
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
      claudeConfigDir: expect.stringContaining('claude-api'),
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
      () => undefined,
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
      () => undefined,
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

describe('activateInstalledManagedClaude', () => {
  function fixture() {
    let settings = {
      ...DEFAULT_SETTINGS,
      claudeRuntimeSource: 'custom' as const,
      claudeCodePath: '/missing/claude',
    } as typeof DEFAULT_SETTINGS
    const service = {
      getRuntimeSettings: () => settings,
      set: vi.fn(async (partial) => {
        settings = { ...settings, ...partial }
        return settings
      }),
    }
    const runtime = {
      source: 'managed',
      executablePath: '/studio/claude',
      claudeCodeVersion: '2.1.211',
      sdkVersion: '0.3.211',
      fingerprint: 'a'.repeat(64),
      integrity: 'catalog-sha256',
      probedAt: 1,
    }
    const manager = {
      probe: vi.fn(async () => ({ success: true, runtime })),
      commit: vi.fn(),
      getStatus: vi.fn(() => ({ active: runtime })),
      reportFailure: vi.fn(),
    }
    const bridge = createAgentBridge()
    const recover = vi.fn(async () => undefined)
    const activate = () =>
      activateInstalledManagedClaude(
        '2.1.211',
        service as never,
        manager as never,
        bridge as never,
        recover,
      )
    return { service, manager, bridge, recover, activate }
  }

  it('enables the verified managed binary without a Key, clearing only the obsolete path', async () => {
    const f = fixture()
    await f.activate()
    expect(f.manager.probe).toHaveBeenCalledWith({ source: 'managed', version: '2.1.211' })
    expect(f.service.set).toHaveBeenCalledWith({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
      claudeCodePath: '',
    })
    expect(f.bridge.reconfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeCodePath: '/studio/claude',
        apiKey: '',
        runtimeProvenance: expect.objectContaining({ source: 'managed' }),
      }),
      { forceResetSessions: false },
    )
    expect(f.recover).not.toHaveBeenCalled()
  })

  it('does not replace the selected runtime when probing or persistence fails', async () => {
    const f = fixture()
    f.manager.probe.mockResolvedValueOnce({
      success: false,
      failure: { code: 'MANAGED_RUNTIME_INTEGRITY_FAILED', message: 'damaged' },
    } as never)
    await expect(f.activate()).rejects.toThrow('damaged')
    expect(f.service.set).not.toHaveBeenCalled()
    expect(f.manager.commit).not.toHaveBeenCalled()
    f.service.set.mockRejectedValueOnce(new Error('disk full'))
    await expect(f.activate()).rejects.toThrow('disk full')
    expect(f.manager.commit).not.toHaveBeenCalled()
    expect(f.bridge.reconfigure).not.toHaveBeenCalled()
  })

  it('reports a backend application failure and allows activation to be retried', async () => {
    const f = fixture()
    f.bridge.reconfigure.mockImplementationOnce(() => {
      throw new Error('backend failed')
    })
    await expect(f.activate()).rejects.toThrow('未能应用新配置')
    expect(f.manager.reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RUNTIME_SWITCH_PENDING' }),
    )
    await expect(f.activate()).resolves.toBeUndefined()
    expect(f.bridge.reconfigure).toHaveBeenCalledTimes(2)
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
