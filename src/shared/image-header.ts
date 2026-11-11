import type { ImageAttachmentMediaType } from './image-attachment'

export interface ImageHeader {
  mediaType: ImageAttachmentMediaType
  width: number
  height: number
  firstFrameOnly: boolean
}

/** Read bounded raster headers before allocating a decoded bitmap. Never decode SVG/HTML. */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + length))
  const result = (
    mediaType: ImageAttachmentMediaType,
    width: number,
    height: number,
    firstFrameOnly = false,
  ): ImageHeader => {
    if (!width || !height) throw new Error('图片尺寸无效')
    return { mediaType, width, height, firstFrameOnly }
  }
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 7) === 'PNG\r\n\x1a\n' &&
    ascii(12, 4) === 'IHDR'
  ) {
    let animated = false
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = view.getUint32(offset)
      if (ascii(offset + 4, 4) === 'acTL') animated = true
      if (ascii(offset + 4, 4) === 'IDAT') break
      offset += length + 12
    }
    return result('image/png', view.getUint32(16), view.getUint32(20), animated)
  }
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
    return result('image/gif', view.getUint16(6, true), view.getUint16(8, true), true)
  }
  if (bytes.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const type = ascii(12, 4)
    const uint24 = (offset: number): number =>
      bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    if (type === 'VP8X' && bytes.length >= 30)
      return result('image/webp', uint24(24) + 1, uint24(27) + 1, Boolean(bytes[20] & 2))
    if (
      type === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      return result(
        'image/webp',
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      )
    }
    if (type === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return result('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 8
      ) {
        return result('image/jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3))
      }
      offset += length
    }
  }
  throw new Error('图片格式无效或文件已损坏；仅支持 PNG、JPEG、GIF 和 WebP')
}
