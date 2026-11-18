import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerRuntimeComponentsIpc } from './runtime-components-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

describe('registerRuntimeComponentsIpc', () => {
  const trustedRendererGuard = {
    assert: vi.fn(),
    isTrusted: vi.fn(() => true),
  }

  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
    mockIpcMain.handle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        mockIpcMain.handlers.set(channel, handler)
      },
    )
    trustedRendererGuard.assert.mockClear()
  })

  it('registers bounded lifecycle operations behind the trusted renderer guard', async () => {
    const status = {
      componentId: 'claude-runtime',
      phase: 'installed',
      constrainedVersion: '2.1.211',
      installedVersions: ['2.1.211'],
    }
    const manager = {
      getManagedClaudeStatus: vi.fn(() => status),
      checkManagedClaude: vi.fn(async () => ({ success: true, status })),
      installManagedClaude: vi.fn(async () => ({ success: true, status })),
      repairManagedClaude: vi.fn(async () => ({ success: true, status })),
      uninstallManagedClaude: vi.fn(async () => ({ success: true, status })),
      listRuntimeResources: vi.fn(() => []),
      checkRuntimeResource: vi.fn(async () => ({ success: true, status: {} })),
      installRuntimeResource: vi.fn(async () => ({ success: true, status: {} })),
      repairRuntimeResource: vi.fn(async () => ({ success: true, status: {} })),
      uninstallRuntimeResource: vi.fn(async () => ({ success: true, status: {} })),
    }
    const activateManagedClaude = vi.fn(async () => undefined)
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
      activateManagedClaude,
    })

    expect([...mockIpcMain.handlers.keys()]).toEqual([
      'runtime-components:getManagedClaudeStatus',
      'runtime-components:checkManagedClaude',
      'runtime-components:installManagedClaude',
      'runtime-components:repairManagedClaude',
      'runtime-components:uninstallManagedClaude',
      'runtime-components:listRuntimeResources',
      'runtime-components:checkRuntimeResource',
      'runtime-components:installRuntimeResource',
      'runtime-components:repairRuntimeResource',
      'runtime-components:uninstallRuntimeResource',
    ])
    await mockIpcMain.handlers.get('runtime-components:getManagedClaudeStatus')?.({})
    await mockIpcMain.handlers.get('runtime-components:checkManagedClaude')?.({})
    await mockIpcMain.handlers.get('runtime-components:installManagedClaude')?.({})
    await mockIpcMain.handlers.get('runtime-components:repairManagedClaude')?.({})
    await mockIpcMain.handlers.get('runtime-components:uninstallManagedClaude')?.({})
    await mockIpcMain.handlers.get('runtime-components:listRuntimeResources')?.({})
    await mockIpcMain.handlers.get('runtime-components:checkRuntimeResource')?.({}, 'occt-runtime')
    await mockIpcMain.handlers.get('runtime-components:installRuntimeResource')?.(
      {},
      'occt-runtime',
    )
    await mockIpcMain.handlers.get('runtime-components:repairRuntimeResource')?.({}, 'occt-runtime')
    await mockIpcMain.handlers.get('runtime-components:uninstallRuntimeResource')?.(
      {},
      'occt-runtime',
    )
    expect(trustedRendererGuard.assert).toHaveBeenCalledTimes(10)
    expect(manager.getManagedClaudeStatus).toHaveBeenCalledOnce()
    expect(manager.installManagedClaude).toHaveBeenCalledOnce()
    expect(manager.repairManagedClaude).toHaveBeenCalledOnce()
    expect(activateManagedClaude).toHaveBeenCalledTimes(2)
    expect(activateManagedClaude).toHaveBeenCalledWith('2.1.211')
    expect(manager.uninstallManagedClaude).toHaveBeenCalledOnce()
    expect(manager.listRuntimeResources).toHaveBeenCalledOnce()
    expect(manager.installRuntimeResource).toHaveBeenCalledWith('occt-runtime')
  })

  it('blocks Claude install and repair during a run and uninstall while managed is selected', async () => {
    const status = { componentId: 'claude-runtime', phase: 'installed' }
    const manager = {
      getManagedClaudeStatus: vi.fn(() => status),
      checkManagedClaude: vi.fn(),
      installManagedClaude: vi.fn(),
      repairManagedClaude: vi.fn(),
      uninstallManagedClaude: vi.fn(),
      listRuntimeResources: vi.fn(() => []),
      checkRuntimeResource: vi.fn(),
      installRuntimeResource: vi.fn(),
      repairRuntimeResource: vi.fn(),
      uninstallRuntimeResource: vi.fn(),
    }
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
      beginManagedClaudeMutation: () => null,
      isManagedClaudeSelected: () => true,
    })

    const installing = await mockIpcMain.handlers.get('runtime-components:installManagedClaude')?.(
      {},
    )
    expect(installing).toMatchObject({ success: false, error: expect.stringContaining('正在响应') })
    expect(manager.installManagedClaude).not.toHaveBeenCalled()

    const busy = await mockIpcMain.handlers.get('runtime-components:repairManagedClaude')?.({})
    expect(busy).toMatchObject({ success: false, error: expect.stringContaining('正在响应') })
    expect(manager.repairManagedClaude).not.toHaveBeenCalled()

    mockIpcMain.handlers.clear()
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
      beginManagedClaudeMutation: () => () => undefined,
      isManagedClaudeSelected: () => true,
    })
    const active = await mockIpcMain.handlers.get('runtime-components:uninstallManagedClaude')?.({})
    expect(active).toMatchObject({
      success: false,
      error: expect.stringContaining('先在 Agent 设置'),
    })
    expect(manager.uninstallManagedClaude).not.toHaveBeenCalled()
  })

  it.each(['install', 'repair'] as const)(
    'keeps the configuration locked through %s and activation',
    async (operation) => {
      const status = { constrainedVersion: '2.1.211', installedVersions: ['2.1.211'] }
      const events: string[] = []
      let finishActivation!: () => void
      const activation = new Promise<void>((resolve) => {
        finishActivation = resolve
      })
      const manager = {
        installManagedClaude: vi.fn(async () => {
          events.push('install')
          return { success: true, status }
        }),
        repairManagedClaude: vi.fn(async () => {
          events.push('repair')
          return { success: true, status }
        }),
      }
      registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
        beginManagedClaudeMutation: () => {
          events.push('lock')
          return () => {
            events.push('unlock')
          }
        },
        activateManagedClaude: async () => {
          events.push('activate')
          await activation
        },
      })
      const result = mockIpcMain.handlers.get(`runtime-components:${operation}ManagedClaude`)?.({})
      await vi.waitFor(() => expect(events).toEqual(['lock', operation, 'activate']))
      finishActivation()
      await expect(result).resolves.toMatchObject({ success: true })
      expect(events).toEqual(['lock', operation, 'activate', 'unlock'])
    },
  )

  it('keeps download failure separate from activation failure and always unlocks', async () => {
    const status = { constrainedVersion: '2.1.211', installedVersions: ['2.1.211'] }
    const release = vi.fn()
    const manager = {
      installManagedClaude: vi
        .fn()
        .mockResolvedValueOnce({ success: false, status, error: 'DOWNLOAD_FAILED' })
        .mockResolvedValue({ success: true, status }),
    }
    const activateManagedClaude = vi.fn(async () => {
      throw new Error('disk full')
    })
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
      beginManagedClaudeMutation: () => release,
      activateManagedClaude,
    })
    const install = mockIpcMain.handlers.get('runtime-components:installManagedClaude')!
    await expect(install({})).resolves.toMatchObject({ success: false, error: 'DOWNLOAD_FAILED' })
    expect(activateManagedClaude).not.toHaveBeenCalled()
    await expect(install({})).resolves.toMatchObject({
      success: false,
      status,
      error: expect.stringContaining('已安装，但启用失败：disk full'),
    })
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('does not install without an activation coordinator', async () => {
    const manager = { getManagedClaudeStatus: vi.fn(() => ({})), installManagedClaude: vi.fn() }
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never)
    await expect(
      mockIpcMain.handlers.get('runtime-components:installManagedClaude')?.({}),
    ).resolves.toMatchObject({ success: false })
    expect(manager.installManagedClaude).not.toHaveBeenCalled()
  })
})
