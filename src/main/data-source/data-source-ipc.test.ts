import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDataSourceIpc } from './data-source-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

describe('registerDataSourceIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('rejects an untrusted sender before reading sources', () => {
    const service = createService()
    registerDataSourceIpc(service as never, createGuard('trusted') as never)

    expect(() => mockIpcMain.handlers.get('data-source:list')?.({ sender: 'other' })).toThrow(
      'untrusted',
    )
    expect(service.listSources).not.toHaveBeenCalled()
  })

  it('returns a bounded validation error before creating a source', async () => {
    const service = createService()
    registerDataSourceIpc(service as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('data-source:create')?.(
        { sender: 'trusted' },
        { type: 'elasticsearch', name: 'Local file', endpoint: 'file:///tmp/index' },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'DATA_SOURCE_QUERY_INVALID' },
    })
    expect(service.createSource).not.toHaveBeenCalled()
  })

  it('passes a trusted valid source to the service', async () => {
    const service = createService()
    registerDataSourceIpc(service as never, createGuard('trusted') as never)
    const input = {
      type: 'elasticsearch',
      name: 'Research',
      endpoint: 'https://search.example.com',
    }

    await expect(
      mockIpcMain.handlers.get('data-source:create')?.({ sender: 'trusted' }, input),
    ).resolves.toMatchObject({ success: true })
    expect(service.createSource).toHaveBeenCalledWith(input)
  })
})

function createService() {
  return {
    listSources: vi.fn(async () => []),
    createSource: vi.fn(async (input) => input),
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
