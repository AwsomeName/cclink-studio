import { describe, expect, it } from 'vitest'
import { agentSendMessageInputSchema } from './agent-schema'

describe('agentSendMessageInputSchema image attachments', () => {
  it('accepts a bounded supported image', () => {
    expect(
      agentSendMessageInputSchema.parse({
        message: '看图',
        images: [
          {
            id: 'image-1',
            name: 'screen.png',
            mediaType: 'image/png',
            data: 'AQID',
            size: 3,
          },
        ],
      }),
    ).toMatchObject({ images: [{ mediaType: 'image/png', data: 'AQID' }] })
  })

  it('rejects unsupported image formats and inconsistent size limits', () => {
    expect(() =>
      agentSendMessageInputSchema.parse({
        message: '看图',
        images: [
          {
            id: 'image-1',
            name: 'vector.svg',
            mediaType: 'image/svg+xml',
            data: 'AQID',
            size: 3,
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      agentSendMessageInputSchema.parse({
        message: '看图',
        images: [
          {
            id: 'image-1',
            name: 'huge.png',
            mediaType: 'image/png',
            data: 'AQID',
            size: 5 * 1024 * 1024 + 1,
          },
        ],
      }),
    ).toThrow()
  })
})
