import { afterEach, describe, expect, it, vi } from 'vitest'
import type RFB from '@novnc/novnc'
import type { DesktopImagePasteResult } from '@shared/ipc/remote-desktop'
import { installMacImagePaste } from './mac-image-paste'

function fixture(support = true) {
  const handlers = new Map<string, (event: Partial<KeyboardEvent>) => void>()
  const canvas = {}
  const screen = {
    addEventListener: (name: string, fn: (event: Partial<KeyboardEvent>) => void) =>
      handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
    contains: (node: unknown) => node === canvas,
  }
  vi.stubGlobal('document', { activeElement: canvas })
  vi.stubGlobal('window', new EventTarget())
  let resolve!: (result: DesktopImagePasteResult) => void
  const promise = new Promise<DesktopImagePasteResult>((done) => {
    resolve = done
  })
  const reply = { promise, resolve }
  const transfer = vi.fn(() => reply.promise)
  const sendKey = vi.fn()
  const report = vi.fn()
  const dispose = installMacImagePaste(
    { capabilities: { appleImageClipboard: support }, sendKey } as unknown as RFB,
    screen as unknown as HTMLElement,
    () => true,
    transfer,
    report,
  )
  const key = (code: string, type = 'keydown') =>
    handlers.get(type)?.({
      code,
      type,
      metaKey: true,
      isTrusted: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    })
  return { key, reply, transfer, sendKey, report, dispose, handlers }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('remote Mac screenshot shortcut', () => {
  it('sends one chord after transfer when the physical Command has been released', async () => {
    const test = fixture()
    test.key('MetaLeft')
    test.key('KeyV')
    test.key('KeyV')
    test.key('MetaLeft', 'keyup')
    expect(test.transfer).toHaveBeenCalledTimes(1)
    expect(test.sendKey).not.toHaveBeenCalled()
    test.reply.resolve('sent')
    await test.reply.promise
    expect(test.sendKey.mock.calls).toEqual([
      [0xffeb, 'MetaLeft', true],
      [0x76, 'KeyV'],
      [0xffeb, 'MetaLeft', false],
    ])
    test.dispose()
  })

  it('reuses a still-held Command for normal remote paste', async () => {
    const test = fixture()
    test.key('MetaRight')
    test.key('KeyV')
    test.reply.resolve('no-image')
    await test.reply.promise
    expect(test.sendKey.mock.calls).toEqual([[0x76, 'KeyV']])
    test.dispose()
  })

  it('does not paste stale clipboard contents on an unsupported server', async () => {
    const test = fixture(false)
    test.key('KeyV')
    expect(test.transfer).toHaveBeenCalledWith(false)
    test.reply.resolve('unsupported')
    await test.reply.promise
    expect(test.sendKey).not.toHaveBeenCalled()
    expect(test.report).toHaveBeenCalledWith('这台 Mac 未提供图片剪贴板。')
    test.dispose()
  })

  it('drops late completion after focus has left and returned', async () => {
    const test = fixture()
    test.key('KeyV')
    test.handlers.get('focusout')?.({})
    test.reply.resolve('sent')
    await test.reply.promise
    expect(test.sendKey).not.toHaveBeenCalled()
    test.dispose()
  })
})
