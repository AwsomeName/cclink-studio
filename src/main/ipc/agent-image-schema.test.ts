import { describe, expect, it } from 'vitest'
import { agentSendMessageInputSchema } from '../../shared/ipc/agent-schema'
import { agentImagesSchema } from '../../shared/ipc/image-attachment-schema'
import { MAX_AGENT_IMAGE_BYTES, MAX_AGENT_IMAGES } from '../../shared/agent-image-limits'

describe('agentSendMessageInputSchema image attachments', () => {
  it('accepts five maximum-size prepared images including multibyte names and metadata', () => {
    const images = Array.from({ length: MAX_AGENT_IMAGES }, (_, i) => ({
      id: `image-${i}`,
      name: '图'.repeat(512),
      mediaType: 'image/png',
      size: MAX_AGENT_IMAGE_BYTES,
      data: Buffer.alloc(MAX_AGENT_IMAGE_BYTES).toString('base64'),
      preparation: {
        originalSize: 20 * 1024 * 1024,
        originalWidth: 4000,
        originalHeight: 3000,
        width: 4000,
        height: 3000,
        firstFrameOnly: false,
        requiresReview: false,
      },
    }))
    expect(agentImagesSchema.safeParse(images).success).toBe(true)
    expect(
      agentSendMessageInputSchema.safeParse({ message: '检查这五张图片', images }).success,
    ).toBe(true)
    expect(agentImagesSchema.safeParse([...images, images[0]]).success).toBe(false)
  })

  it('rejects a forged byte count and malformed Base64 padding', () => {
    const image = { id: 'image', name: 'x.png', mediaType: 'image/png', data: 'AQID', size: 2 }
    expect(agentImagesSchema.safeParse([image]).success).toBe(false)
    expect(agentImagesSchema.safeParse([{ ...image, data: 'AQI', size: 2 }]).success).toBe(false)
  })
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
