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
    trustedRendererGuard.assert.mockClear()
  })

  it('registers bounded status and install operations behind the trusted renderer guard', async () => {
    const status = { componentId: 'claude-runtime', phase: 'idle' }
    const manager = {
      getManagedClaudeStatus: vi.fn(() => status),
      installManagedClaude: vi.fn(async () => ({ success: true, status })),
      listRuntimeResources: vi.fn(() => []),
      installRuntimeResource: vi.fn(async () => ({ success: true, status: {} })),
    }
    registerRuntimeComponentsIpc(manager as never, trustedRendererGuard as never)

    expect([...mockIpcMain.handlers.keys()]).toEqual([
      'runtime-components:getManagedClaudeStatus',
      'runtime-components:installManagedClaude',
      'runtime-components:listRuntimeResources',
      'runtime-components:installRuntimeResource',
    ])
    await mockIpcMain.handlers.get('runtime-components:getManagedClaudeStatus')?.({})
    await mockIpcMain.handlers.get('runtime-components:installManagedClaude')?.({})
    await mockIpcMain.handlers.get('runtime-components:listRuntimeResources')?.({})
    await mockIpcMain.handlers.get('runtime-components:installRuntimeResource')?.(
      {},
      'occt-runtime',
    )
    expect(trustedRendererGuard.assert).toHaveBeenCalledTimes(4)
    expect(manager.getManagedClaudeStatus).toHaveBeenCalledOnce()
    expect(manager.installManagedClaude).toHaveBeenCalledOnce()
    expect(manager.listRuntimeResources).toHaveBeenCalledOnce()
    expect(manager.installRuntimeResource).toHaveBeenCalledWith('occt-runtime')
  })
})
