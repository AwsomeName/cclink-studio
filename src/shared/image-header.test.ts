import { describe, expect, it } from 'vitest'
import { readImageHeader } from './image-header'

describe('bounded raster header detection', () => {
  it('reads PNG and GIF dimensions and animation policy', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    )
    expect(readImageHeader(png)).toEqual({
      mediaType: 'image/png',
      width: 1,
      height: 1,
      firstFrameOnly: false,
    })
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    expect(readImageHeader(gif)).toMatchObject({
      mediaType: 'image/gif',
      width: 1,
      height: 1,
      firstFrameOnly: true,
    })
  })

  it('reads progressive JPEG dimensions before decoding', () => {
    const bytes = Buffer.from([255, 216, 255, 226, 0, 4, 0, 0, 255, 194, 0, 8, 8, 2, 0, 3, 0, 1])
    expect(readImageHeader(bytes)).toMatchObject({
      mediaType: 'image/jpeg',
      width: 768,
      height: 512,
    })
  })

  it('reads short lossless and animated extended WebP headers', () => {
    const bytes = Buffer.alloc(26)
    bytes.write('RIFF', 0)
    bytes.write('WEBPVP8L', 8)
    bytes[20] = 0x2f
    expect(readImageHeader(bytes)).toMatchObject({ mediaType: 'image/webp', width: 1, height: 1 })
    const extended = Buffer.alloc(30)
    extended.write('RIFF', 0)
    extended.write('WEBPVP8X', 8)
    extended[20] = 2
    extended[24] = 9
    extended[27] = 19
    expect(readImageHeader(extended)).toMatchObject({ width: 10, height: 20, firstFrameOnly: true })
  })

  it.each([
    Buffer.from('<svg></svg>'),
    Buffer.from('PNG'),
    Buffer.from([255, 216, 255, 194, 0, 100]),
  ])('rejects non-raster or truncated headers', (bytes) => {
    expect(() => readImageHeader(bytes)).toThrow('图片格式无效')
  })
})
