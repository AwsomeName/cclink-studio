import { describe, expect, it, vi } from 'vitest'
import { importAgentImageFiles } from './image-attachments'
import { MAX_AGENT_IMAGE_BYTES, MAX_AGENT_SOURCE_IMAGE_BYTES } from '@shared/agent-image-limits'

describe('importAgentImageFiles', () => {
  it('prepares five 20MB sources and only encodes the bounded sending copies', async () => {
    const source = new File([new Uint8Array(MAX_AGENT_SOURCE_IMAGE_BYTES)], 'large.png', {
      type: 'image/png',
    })
    const prepare = vi.fn(async () => ({
      blob: new Blob([new Uint8Array(MAX_AGENT_IMAGE_BYTES)], { type: 'image/webp' }),
    }))
    const result = await importAgentImageFiles(Array(5).fill(source), 5, { prepare })
    expect(result.errors).toEqual([])
    expect(result.attachments).toHaveLength(5)
    expect(
      result.attachments.every(
        (image) => image.size === MAX_AGENT_IMAGE_BYTES && image.mediaType === 'image/webp',
      ),
    ).toBe(true)
    expect(prepare).toHaveBeenCalledTimes(5)
  })

  it('rejects oversized originals before decoding, continues after a damaged image', async () => {
    const huge = new File([new Uint8Array(MAX_AGENT_SOURCE_IMAGE_BYTES + 1)], 'huge.png', {
      type: 'image/png',
    })
    const bad = new File(['bad'], 'bad.png', { type: 'image/png' })
    const good = new File(['ok'], 'ok.png', { type: 'image/png' })
    const prepare = vi.fn(async (file: File) => {
      if (file === bad) throw new Error('图片损坏')
      return { blob: file }
    })
    const result = await importAgentImageFiles([huge, bad, good], 5, { prepare })
    expect(result.attachments.map((image) => image.name)).toEqual(['ok.png'])
    expect(result.errors).toEqual([
      expect.stringContaining('20MB'),
      expect.stringContaining('图片损坏'),
    ])
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('does not append an image after cancellation during processing', async () => {
    const controller = new AbortController()
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    await expect(
      importAgentImageFiles([file], 5, {
        signal: controller.signal,
        prepare: async () => {
          controller.abort()
          return { blob: file }
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('imports supported image files as transient base64 attachments', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' })

    const result = await importAgentImageFiles([file], 5, {
      prepare: async (source) => ({ blob: source }),
    })

    expect(result.errors).toEqual([])
    expect(result.attachments).toEqual([
      expect.objectContaining({
        name: 'screen.png',
        mediaType: 'image/png',
        data: 'AQID',
        size: 3,
      }),
    ])
  })

  it('rejects unsupported formats and enforces the available attachment slots', async () => {
    const unsupported = new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })
    const png = new File(['png'], 'screen.png', { type: 'image/png' })

    const unsupportedResult = await importAgentImageFiles([unsupported])
    const fullResult = await importAgentImageFiles([png], 0)

    expect(unsupportedResult.attachments).toEqual([])
    expect(unsupportedResult.errors[0]).toContain('仅支持')
    expect(fullResult.attachments).toEqual([])
    expect(fullResult.errors[0]).toContain('最多发送')
  })
})
