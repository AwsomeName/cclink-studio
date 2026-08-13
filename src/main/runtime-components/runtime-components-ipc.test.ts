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
    const status = { componentId: 'claude-runtime', phase: 'idle' }
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
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never)

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
    expect(manager.uninstallManagedClaude).toHaveBeenCalledOnce()
    expect(manager.listRuntimeResources).toHaveBeenCalledOnce()
    expect(manager.installRuntimeResource).toHaveBeenCalledWith('occt-runtime')
  })

  it('blocks Claude repair during a run and uninstall while the managed runtime is active', async () => {
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
      isManagedClaudeActive: () => true,
    })

    const busy = await mockIpcMain.handlers.get('runtime-components:repairManagedClaude')?.({})
    expect(busy).toMatchObject({ success: false, error: expect.stringContaining('正在响应') })
    expect(manager.repairManagedClaude).not.toHaveBeenCalled()

    mockIpcMain.handlers.clear()
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never, {
      beginManagedClaudeMutation: () => () => undefined,
      isManagedClaudeActive: () => true,
    })
    const active = await mockIpcMain.handlers.get('runtime-components:uninstallManagedClaude')?.({})
    expect(active).toMatchObject({
      success: false,
      error: expect.stringContaining('先在 Agent 设置'),
    })
    expect(manager.uninstallManagedClaude).not.toHaveBeenCalled()
  })
})
