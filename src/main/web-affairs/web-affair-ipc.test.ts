import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerWebAffairIpc } from './web-affair-ipc'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_SCOPE = { workspaceRef: { kind: 'local', path: '/Users/example/project' } }

describe('registerWebAffairIpc', () => {
  beforeEach(() => mockIpcMain.handlers.clear())

  it('rejects an untrusted sender before reading affairs', () => {
    const service = { getSnapshot: vi.fn() }
    registerWebAffairIpc(() => service as never, createGuard('trusted') as never)

    expect(() => mockIpcMain.handlers.get('webAffairs:getSnapshot')?.({ sender: 'other' })).toThrow(
      'untrusted',
    )
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('maps invalid creation input to a bounded error', async () => {
    const service = { createAffair: vi.fn() }
    registerWebAffairIpc(() => service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('webAffairs:createAffair')?.(
        { sender: 'trusted' },
        { title: '', objective: '', principalId: 'unsafe' },
      ),
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    expect(service.createAffair).not.toHaveBeenCalled()
  })

  it('resolves the renderer workspace to a stable id before returning affairs', async () => {
    const service = {
      getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [] } })),
    }
    const workspaceState = { getLocalProjectId: vi.fn(async () => WORKSPACE_ID) }
    registerWebAffairIpc(
      () => service as never,
      createGuard('trusted') as never,
      () => null,
      () => workspaceState as never,
    )

    await expect(
      mockIpcMain.handlers.get('webAffairs:getSnapshot')?.({ sender: 'trusted' }, WORKSPACE_SCOPE),
    ).resolves.toMatchObject({ success: true, data: { affairs: [] } })
    expect(workspaceState.getLocalProjectId).toHaveBeenCalledWith('/Users/example/project')
    expect(service.getProjectSnapshot).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('resolves and forwards the stable workspace id for affair mutations', async () => {
    const updateNode = vi.fn(async () => ({ success: true, data: { id: 'affair' } }))
    const workspaceState = { getLocalProjectId: vi.fn(async () => WORKSPACE_ID) }
    registerWebAffairIpc(
      () => ({ updateNode }) as never,
      createGuard('trusted') as never,
      () => null,
      () => workspaceState as never,
    )
    const input = {
      ...WORKSPACE_SCOPE,
      affairId: '22222222-2222-4222-8222-222222222222',
      nodeId: '33333333-3333-4333-8333-333333333333',
      status: 'completed',
      resultNote: '已取得可核验的网页结果',
    }

    await expect(
      mockIpcMain.handlers.get('webAffairs:updateNode')?.({ sender: 'trusted' }, input),
    ).resolves.toMatchObject({ success: true })
    expect(updateNode).toHaveBeenCalledWith(input, WORKSPACE_ID)
  })

  it('resolves the stable workspace id before assigning one legacy affair', async () => {
    const claimLegacyAffair = vi.fn(async () => ({ success: true, data: { id: 'affair' } }))
    const workspaceState = { getLocalProjectId: vi.fn(async () => WORKSPACE_ID) }
    registerWebAffairIpc(
      () => ({ claimLegacyAffair }) as never,
      createGuard('trusted') as never,
      () => null,
      () => workspaceState as never,
    )
    const input = {
      ...WORKSPACE_SCOPE,
      affairId: '22222222-2222-4222-8222-222222222222',
    }

    await expect(
      mockIpcMain.handlers.get('webAffairs:claimLegacyAffair')?.({ sender: 'trusted' }, input),
    ).resolves.toMatchObject({ success: true })
    expect(claimLegacyAffair).toHaveBeenCalledWith(input, WORKSPACE_ID)
  })

  it('returns a structured degraded result', async () => {
    registerWebAffairIpc(
      () => null,
      createGuard('trusted') as never,
      () => null,
      () => ({ getLocalProjectId: vi.fn(async () => WORKSPACE_ID) }) as never,
    )

    await expect(
      mockIpcMain.handlers.get('webAffairs:getSnapshot')?.({ sender: 'trusted' }, WORKSPACE_SCOPE),
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '事务服务当前不可用，其他工作台能力不受影响',
      },
    })
  })
})

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
