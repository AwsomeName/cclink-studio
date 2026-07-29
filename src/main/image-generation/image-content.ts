import type { GeneratedImage } from './types'

export const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024

export function normalizeImageMimeType(value: string | null): GeneratedImage['mimeType'] | null {
  const normalized = value?.split(';')[0].trim().toLowerCase()
  if (normalized === 'image/jpg') return 'image/jpeg'
  return normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp'
    ? normalized
    : null
}

export function validateImageContent(
  content: Buffer,
  declaredMimeType?: GeneratedImage['mimeType'],
): GeneratedImage['mimeType'] {
  if (content.byteLength === 0 || content.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error('生成图片为空或超过 25MB 限制')
  }
  const detected = detectImageMimeType(content)
  if (!detected) throw new Error('生成结果不是受支持的 PNG、JPEG 或 WebP 图片')
  if (declaredMimeType && declaredMimeType !== detected) {
    throw new Error('下载内容与声明的图片类型不一致')
  }
  return detected
}

function detectImageMimeType(content: Buffer): GeneratedImage['mimeType'] | null {
  if (
    content.byteLength >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png'
  }
  if (content.byteLength >= 2 && content[0] === 0xff && content[1] === 0xd8) {
    return 'image/jpeg'
  }
  if (
    content.byteLength >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}
