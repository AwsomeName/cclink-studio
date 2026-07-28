import type { AgentImageAttachment, AgentImageMediaType } from '@shared/ipc/agent'

export const MAX_AGENT_IMAGES = 5
export const MAX_AGENT_IMAGE_BYTES = 5 * 1024 * 1024
export const AGENT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

const SUPPORTED_MEDIA_TYPES = new Set<AgentImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export interface ImageAttachmentImportResult {
  attachments: AgentImageAttachment[]
  errors: string[]
}

export async function importAgentImageFiles(
  files: Iterable<File>,
  availableSlots = MAX_AGENT_IMAGES,
): Promise<ImageAttachmentImportResult> {
  const attachments: AgentImageAttachment[] = []
  const errors: string[] = []

  for (const file of files) {
    if (attachments.length >= availableSlots) {
      errors.push(`每次最多发送 ${MAX_AGENT_IMAGES} 张图片`)
      break
    }
    if (!SUPPORTED_MEDIA_TYPES.has(file.type as AgentImageMediaType)) {
      errors.push(`${file.name || '图片'}：仅支持 PNG、JPEG、GIF 和 WebP`)
      continue
    }
    if (file.size <= 0 || file.size > MAX_AGENT_IMAGE_BYTES) {
      errors.push(`${file.name || '图片'}：单张图片不能超过 5MB`)
      continue
    }
    attachments.push({
      id: `image-${crypto.randomUUID()}`,
      name: file.name || `pasted-${Date.now()}.${extensionForMediaType(file.type)}`,
      mediaType: file.type as AgentImageMediaType,
      data: arrayBufferToBase64(await file.arrayBuffer()),
      size: file.size,
    })
  }

  return { attachments, errors: [...new Set(errors)] }
}

export function imageAttachmentDataUrl(image: AgentImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  return mediaType.slice('image/'.length)
}
