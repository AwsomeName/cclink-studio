import { describe, expect, it, vi } from 'vitest'
import {
  base64ToBlob,
  copyBase64ImageToClipboard,
  type ImageClipboardEnvironment,
} from './image-clipboard'

describe('image clipboard', () => {
  it('decodes base64 image bytes without changing their MIME type', async () => {
    const blob = base64ToBlob('iVBORw==', 'image/png')

    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('writes PNG content as an image/png clipboard item', async () => {
    const item = {} as ClipboardItem
    const environment: ImageClipboardEnvironment = {
      createClipboardItem: vi.fn().mockReturnValue(item),
      write: vi.fn().mockResolvedValue(undefined),
      convertToPng: vi.fn(),
    }

    await copyBase64ImageToClipboard('iVBORw==', 'image/png', environment)

    expect(environment.convertToPng).not.toHaveBeenCalled()
    expect(environment.createClipboardItem).toHaveBeenCalledWith({
      'image/png': expect.objectContaining({ type: 'image/png' }),
    })
    expect(environment.write).toHaveBeenCalledWith([item])
  })

  it('normalizes non-PNG previews before writing to the clipboard', async () => {
    const png = new Blob(['png'], { type: 'image/png' })
    const item = {} as ClipboardItem
    const environment: ImageClipboardEnvironment = {
      createClipboardItem: vi.fn().mockReturnValue(item),
      write: vi.fn().mockResolvedValue(undefined),
      convertToPng: vi.fn().mockResolvedValue(png),
    }

    await copyBase64ImageToClipboard('/9g=', 'image/jpeg', environment)

    expect(environment.convertToPng).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg' }),
    )
    expect(environment.createClipboardItem).toHaveBeenCalledWith({ 'image/png': png })
    expect(environment.write).toHaveBeenCalledWith([item])
  })
})
