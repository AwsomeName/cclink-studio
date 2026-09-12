import { describe, expect, it, vi } from 'vitest'
import { uploadBilibiliImage } from './bilibili-image-upload'

describe('B站 single image chooser', () => {
  it.each(['current', 'cancelled', 'wrong-page', 'click-failed'] as const)('%s', async (mode) => {
    const setFiles = vi.fn().mockResolvedValue(undefined)
    let onChooser: (v: unknown) => void = () => undefined
    let clicked = false
    const page = {
      url: () => 'https://t.bilibili.com/',
      on: vi.fn((_event, fn) => {
        onChooser = fn
      }),
      off: vi.fn(),
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        click: async () => {
          clicked = true
          if (mode === 'click-failed') throw new Error('click failed')
          onChooser({ page: () => (mode === 'wrong-page' ? {} : page), setFiles })
        },
      }),
    }
    const assertCurrent = () => {
      if (mode === 'cancelled' && clicked) throw new Error('cancelled')
    }
    const result = uploadBilibiliImage(
      page as never,
      'div.bili-pics-uploader__add',
      ['/article/cover.png'],
      assertCurrent,
    )
    if (mode === 'current') {
      await result
      expect(setFiles).toHaveBeenCalledExactlyOnceWith(['/article/cover.png'])
    } else {
      await expect(result).rejects.toThrow()
      expect(setFiles).not.toHaveBeenCalled()
    }
    expect(page.off).toHaveBeenCalledWith('filechooser', expect.any(Function))
  })
  it('rejects batch files, wrong origin and unrelated controls before opening a chooser', async () => {
    const on = vi.fn()
    for (const [url, selector, paths] of [
      ['https://t.bilibili.com.evil.test/', 'div.bili-pics-uploader__add', ['/a.png']],
      ['https://t.bilibili.com/', 'button.publish', ['/a.png']],
      ['https://t.bilibili.com/', 'div.bili-pics-uploader__add', ['/a.png', '/b.png']],
    ] as const) {
      await expect(
        uploadBilibiliImage({ url: () => url, on } as never, selector, [...paths], () => undefined),
      ).rejects.toThrow()
    }
    expect(on).not.toHaveBeenCalled()
  })
})
