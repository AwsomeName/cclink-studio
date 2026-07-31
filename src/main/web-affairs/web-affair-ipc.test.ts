import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerWebAffairIpc } from './web-affair-ipc'

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

  it('returns a structured degraded result', () => {
    registerWebAffairIpc(() => null, createGuard('trusted') as never)

    expect(mockIpcMain.handlers.get('webAffairs:getSnapshot')?.({ sender: 'trusted' })).toEqual({
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
