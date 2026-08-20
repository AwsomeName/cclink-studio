import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerWorkspaceStateIpc } from './workspace-state-ipc'

describe('registerWorkspaceStateIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('rejects an untrusted sender before reading persistent state', () => {
    const service = createService()
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('workspaceState:get')?.({ sender: 'other' }, null, null),
    ).toThrow('untrusted')
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('rejects unknown sections and oversized state before writing', async () => {
    const service = createService()
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never)
    const setSection = mockIpcMain.handlers.get('workspaceState:setSection')!

    await expect(
      setSection({ sender: 'trusted' }, '/tmp/project', 'arbitrary', {}, null),
    ).resolves.toMatchObject({ success: false })
    await expect(
      setSection(
        { sender: 'trusted' },
        '/tmp/project',
        'layout',
        { content: 'x'.repeat(5 * 1024 * 1024 + 1) },
        null,
      ),
    ).resolves.toEqual({
      success: false,
      error: '保存 layout 失败：工作空间状态 JSON 超过大小限制',
    })
    expect(service.setSection).not.toHaveBeenCalled()
  })

  it('accepts Agent conversation history above the generic workspace section limit', async () => {
    const service = createService()
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never)
    const value = { content: 'x'.repeat(6 * 1024 * 1024) }

    await expect(
      mockIpcMain.handlers.get('workspaceState:setSection')?.(
        { sender: 'trusted' },
        '/tmp/project',
        'agentConversations',
        value,
        null,
      ),
    ).resolves.toMatchObject({ success: true })
    expect(service.setSection).toHaveBeenCalledWith(
      '/tmp/project',
      'agentConversations',
      value,
      null,
    )
  })

  it('writes a bounded known section for an absolute workspace', async () => {
    const service = createService()
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('workspaceState:setSection')?.(
        { sender: 'trusted' },
        '/tmp/project',
        'layout',
        { sidebarWidth: 240 },
        null,
      ),
    ).resolves.toMatchObject({ success: true })
    expect(service.setSection).toHaveBeenCalledWith(
      '/tmp/project',
      'layout',
      { sidebarWidth: 240 },
      null,
    )
  })

  it('rejects renderer writes to the main-owned tabs section', async () => {
    const service = createService()
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('workspaceState:setSection')?.(
        { sender: 'trusted' },
        '/tmp/project',
        'tabs',
        { tabs: [] },
        null,
      ),
    ).resolves.toEqual({
      success: false,
      error: '保存 tabs 失败：tabs 已由主进程 Workbench model 单独拥有，renderer 不得直接写入',
    })
    expect(service.setSection).not.toHaveBeenCalled()
  })

  it('commits the main-process active workspace and persists only its canonical path', async () => {
    const service = createService()
    const settings = { set: vi.fn(async () => ({})) }
    registerWorkspaceStateIpc(service as never, createGuard('trusted') as never, settings as never)

    await expect(
      mockIpcMain.handlers.get('workspaceState:setActiveLocalWorkspace')?.(
        { sender: 'trusted' },
        '/tmp/project',
      ),
    ).resolves.toEqual({
      success: true,
      activeWorkspace: { workspacePath: '/private/tmp/project', generation: 2 },
    })
    expect(settings.set).toHaveBeenCalledWith({ lastWorkspacePath: '/private/tmp/project' })
  })
})

function createService() {
  return {
    getSnapshot: vi.fn(async () => ({ sections: {} })),
    setSection: vi.fn(async () => ({ sections: {} })),
    clear: vi.fn(async () => undefined),
    resolveLocalWorkspace: vi.fn(async () => ({ valid: true })),
    setActiveLocalWorkspace: vi.fn(async () => ({
      workspacePath: '/private/tmp/project',
      generation: 2,
    })),
    listLocalWorkspaces: vi.fn(async () => []),
    getDiagnostics: vi.fn(() => ({})),
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
