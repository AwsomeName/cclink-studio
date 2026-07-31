import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerWebResourceIpc } from './web-resource-ipc'

describe('registerWebResourceIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('rejects an untrusted sender before reading metadata', () => {
    const service = {
      getSnapshot: vi.fn(() => ({ success: true, data: {} })),
    }
    registerWebResourceIpc(() => service as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('webResources:getSnapshot')?.({ sender: 'other' }),
    ).toThrow('untrusted')
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('maps invalid renderer input to a bounded error without calling the service', async () => {
    const service = {
      createConnection: vi.fn(),
    }
    registerWebResourceIpc(() => service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('webResources:createConnection')?.(
        { sender: 'trusted' },
        {
          websiteName: 'Unsafe',
          entryUrl: 'file:///etc/passwd',
          principalKind: 'company',
          principalName: 'Example Ltd.',
          accountLabel: 'Account',
          browserProfileId: 'safe-profile',
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT' },
    })
    expect(service.createConnection).not.toHaveBeenCalled()
  })

  it('returns a structured result when service startup degraded', async () => {
    registerWebResourceIpc(() => null, createGuard('trusted') as never)

    expect(mockIpcMain.handlers.get('webResources:getSnapshot')?.({ sender: 'trusted' })).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '网站与账号服务当前不可用，其他工作台能力不受影响',
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
