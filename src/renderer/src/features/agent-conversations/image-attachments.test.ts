import { describe, expect, it } from 'vitest'
import { importAgentImageFiles } from './image-attachments'

describe('importAgentImageFiles', () => {
  it('imports supported image files as transient base64 attachments', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' })

    const result = await importAgentImageFiles([file])

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
