import {
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_SOURCE_IMAGE_BYTES,
  MAX_AGENT_SOURCE_IMAGE_PIXELS,
  MAX_AGENT_SOURCE_IMAGE_EDGE,
  MAX_AGENT_IMAGE_EDGE,
} from '@shared/agent-image-limits'
import { readImageHeader } from '@shared/image-header'
import type { TransientImageAttachment } from '@shared/image-attachment'

export interface PreparedAgentImage {
  blob: Blob
  preparation?: TransientImageAttachment['preparation']
}

/** Runs in a dedicated worker. Each encoding starts from the original bitmap. */
export async function prepareAgentImage(file: File): Promise<PreparedAgentImage> {
  if (file.size <= 0 || file.size > MAX_AGENT_SOURCE_IMAGE_BYTES) {
    throw new Error('单张原图不能超过 20MB，且不能为空')
  }
  const header = readImageHeader(new Uint8Array(await file.arrayBuffer()))
  if (
    header.width * header.height > MAX_AGENT_SOURCE_IMAGE_PIXELS ||
    Math.max(header.width, header.height) > MAX_AGENT_SOURCE_IMAGE_EDGE
  ) {
    throw new Error('图片像素过大（最多 5000 万像素、单边 32768），请截取重点后添加')
  }
  const source = file.slice(0, file.size, header.mediaType)
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const { width: originalWidth, height: originalHeight } = bitmap
    if (
      !originalWidth ||
      !originalHeight ||
      originalWidth * originalHeight > MAX_AGENT_SOURCE_IMAGE_PIXELS
    ) {
      throw new Error('图片解码尺寸无效或过大')
    }
    if (
      source.size <= MAX_AGENT_IMAGE_BYTES &&
      Math.max(originalWidth, originalHeight) <= MAX_AGENT_IMAGE_EDGE &&
      !header.firstFrameOnly
    ) {
      return { blob: source }
    }
    const initialScale = Math.min(1, MAX_AGENT_IMAGE_EDGE / Math.max(originalWidth, originalHeight))
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    const encode = (type: string, quality?: number): Promise<Blob> =>
      canvas.convertToBlob({ type, quality })
    try {
      for (let attempt = 0; attempt < 9; attempt++) {
        const scale = initialScale * 0.8 ** attempt
        const width = Math.max(1, Math.round(originalWidth * scale))
        const height = Math.max(1, Math.round(originalHeight * scale))
        // A very narrow long screenshot cannot be made readable by shrinking it further.
        if (
          scale < 1 &&
          Math.max(originalWidth, originalHeight) / Math.min(originalWidth, originalHeight) >= 3 &&
          Math.min(originalWidth, originalHeight) >= 400 &&
          Math.min(width, height) < 200
        ) {
          throw new Error('图片过长，继续缩小会丢失文字细节，请分段截取后添加')
        }
        canvas.width = width
        canvas.height = height
        context.drawImage(bitmap, 0, 0, width, height)
        // Keep text/alpha lossless when possible; never flatten transparent images into JPEG.
        let blob =
          header.mediaType === 'image/jpeg'
            ? await encode('image/jpeg', 0.92)
            : await encode('image/png')
        for (const quality of [0.92, 0.85, 0.78]) {
          if (blob.size <= MAX_AGENT_IMAGE_BYTES) break
          blob = await encode(
            header.mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
            quality,
          )
        }
        if (blob.size > 0 && blob.size <= MAX_AGENT_IMAGE_BYTES) {
          return {
            blob,
            preparation: {
              originalSize: file.size,
              originalWidth,
              originalHeight,
              width,
              height,
              firstFrameOnly: header.firstFrameOnly,
              requiresReview:
                scale < 0.7 ||
                (scale < 1 && Math.max(width, height) / Math.min(width, height) >= 3),
            },
          }
        }
      }
      throw new Error('无法在清晰度预算内处理图片，请截取重点后重试')
    } finally {
      canvas.width = canvas.height = 1
    }
  } finally {
    bitmap.close()
  }
}
