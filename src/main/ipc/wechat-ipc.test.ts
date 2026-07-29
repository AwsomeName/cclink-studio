import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))
const mockConvert = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))
vi.mock('../wechat/convert', () => ({
  convertMarkdownDocumentToWechatHTML: mockConvert,
}))

import { registerWechatIPC } from './wechat-ipc'

describe('registerWechatIPC', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockConvert.mockReset()
  })

  it('passes the Markdown document path to the document-level converter', async () => {
    mockConvert.mockResolvedValue({
      html: '<p>article</p>',
      embeddedImages: 1,
      warnings: [],
    })
    registerWechatIPC(createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('wechat:convert')?.(
        { sender: 'trusted' },
        { markdown: '# Article', documentPath: '/tmp/article.md' },
      ),
    ).resolves.toEqual({
      html: '<p>article</p>',
      embeddedImages: 1,
      warnings: [],
    })
    expect(mockConvert).toHaveBeenCalledWith('# Article', '/tmp/article.md')
  })

  it('rejects an untrusted sender before converting local images', () => {
    registerWechatIPC(createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('wechat:convert')?.(
        { sender: 'other' },
        { markdown: '# Article', documentPath: '/tmp/article.md' },
      ),
    ).toThrow('untrusted')
    expect(mockConvert).not.toHaveBeenCalled()
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
