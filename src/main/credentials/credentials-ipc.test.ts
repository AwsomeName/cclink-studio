import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerCredentialsIpc } from './credentials-ipc'

describe('registerCredentialsIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('rejects an untrusted sender before revealing a credential field', () => {
    const service = createService()
    registerCredentialsIpc(service as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('credentials:revealField')?.(
        { sender: 'other' },
        'agent:default',
        'apiKey',
      ),
    ).toThrow('untrusted')
    expect(service.revealField).not.toHaveBeenCalled()
  })

  it('rejects malformed ids and dangerous field names before calling the service', async () => {
    const service = createService()
    registerCredentialsIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('credentials:copyField')?.(
        { sender: 'trusted' },
        '../secret',
        '__proto__',
      ),
    ).resolves.toEqual({ success: false, error: '凭证参数无效' })
    expect(service.copyField).not.toHaveBeenCalled()
  })

  it('returns only the requested field for a trusted valid request', async () => {
    const service = createService()
    service.revealField.mockReturnValue('requested-secret')
    registerCredentialsIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('credentials:revealField')?.(
        { sender: 'trusted' },
        'agent:default',
        'apiKey',
      ),
    ).resolves.toMatchObject({
      success: true,
      value: 'requested-secret',
    })
    expect(service.revealField).toHaveBeenCalledWith('agent:default', 'apiKey')
  })

  it('reports a damaged disk file as a failed reload', async () => {
    const service = createService()
    service.reload.mockResolvedValue({
      status: 'degraded',
      filePath: '/tmp/credentials.json',
      configuredCount: 0,
      legacyEncryptedFiles: [],
      message: '本地凭证文件不是有效 JSON',
    })
    registerCredentialsIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('credentials:reload')?.({ sender: 'trusted' }),
    ).resolves.toMatchObject({
      success: false,
      error: '本地凭证文件不是有效 JSON',
      status: { status: 'degraded' },
    })
  })
})

function createService() {
  return {
    getStatus: vi.fn(() => ({
      status: 'ready',
      filePath: '/tmp/credentials.json',
      configuredCount: 1,
      legacyEncryptedFiles: [],
    })),
    listMetadata: vi.fn(() => []),
    setCredential: vi.fn(),
    revealField: vi.fn(),
    copyField: vi.fn(),
    removeCredential: vi.fn(),
    clearAll: vi.fn(),
    removeLegacyFiles: vi.fn(),
    openDirectory: vi.fn(),
    reload: vi.fn(),
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
