import type { AgentImageAttachment, AgentImageMediaType } from '@shared/ipc/agent'
import {
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_SOURCE_IMAGE_BYTES,
} from '@shared/agent-image-limits'
import type { PreparedAgentImage } from './prepare-agent-image'

export { MAX_AGENT_IMAGES, MAX_AGENT_IMAGE_BYTES } from '@shared/agent-image-limits'
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
  options: { signal?: AbortSignal; prepare?: typeof prepareInWorker } = {},
): Promise<ImageAttachmentImportResult> {
  const attachments: AgentImageAttachment[] = []
  const errors: string[] = []

  for (const file of files) {
    options.signal?.throwIfAborted()
    if (attachments.length >= availableSlots) {
      errors.push(`每次最多发送 ${MAX_AGENT_IMAGES} 张图片`)
      break
    }
    if (file.type && !SUPPORTED_MEDIA_TYPES.has(file.type as AgentImageMediaType)) {
      errors.push(`${file.name || '图片'}：仅支持 PNG、JPEG、GIF 和 WebP`)
      continue
    }
    if (file.size <= 0 || file.size > MAX_AGENT_SOURCE_IMAGE_BYTES) {
      errors.push(`${file.name || '图片'}：单张原图不能超过 20MB，且不能为空`)
      continue
    }
    try {
      const { blob, preparation } = await (options.prepare ?? prepareInWorker)(file, options.signal)
      options.signal?.throwIfAborted()
      if (
        !SUPPORTED_MEDIA_TYPES.has(blob.type as AgentImageMediaType) ||
        blob.size <= 0 ||
        blob.size > MAX_AGENT_IMAGE_BYTES
      ) {
        throw new Error('图片处理结果超出发送预算')
      }
      const data = arrayBufferToBase64(await blob.arrayBuffer())
      options.signal?.throwIfAborted()
      attachments.push({
        id: `image-${crypto.randomUUID()}`,
        name: (file.name.trim() || `pasted-${Date.now()}.${extensionForMediaType(blob.type)}`)
          .slice(0, 512)
          .trim(),
        mediaType: blob.type as AgentImageMediaType,
        data,
        size: blob.size,
        ...(preparation ? { preparation } : {}),
      })
    } catch (error) {
      options.signal?.throwIfAborted()
      errors.push(
        `${file.name || '图片'}：${error instanceof Error ? error.message : '图片处理失败'}`,
      )
    }
  }

  return { attachments, errors: [...new Set(errors)] }
}

// One decoder at a time across composer surfaces. Only bounded prepared bytes become Base64.
let preparationTail: Promise<unknown> = Promise.resolve()
function prepareInWorker(file: File, signal?: AbortSignal): Promise<PreparedAgentImage> {
  const task = preparationTail.then(() => {
    signal?.throwIfAborted()
    return new Promise<PreparedAgentImage>((resolve, reject) => {
      const worker = new Worker(new URL('./agent-image-worker.ts', import.meta.url), {
        type: 'module',
      })
      let settled = false
      const finish = (result?: PreparedAgentImage, error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        worker.onmessage = worker.onerror = worker.onmessageerror = null
        worker.terminate()
        if (error) reject(error)
        else resolve(result!)
      }
      const abort = (): void => finish(undefined, new DOMException('图片处理已取消', 'AbortError'))
      const timeout = setTimeout(
        () => finish(undefined, new Error('图片处理超时，请重试或截取重点')),
        30_000,
      )
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<{ result?: PreparedAgentImage; error?: string }>) => {
        if (event.data.error || !event.data.result)
          finish(undefined, new Error(event.data.error || '图片处理失败'))
        else finish(event.data.result)
      }
      worker.onerror = () => finish(undefined, new Error('图片处理失败，请检查图片后重试'))
      worker.onmessageerror = () => finish(undefined, new Error('无法读取图片处理结果，请重试'))
      try {
        worker.postMessage(file)
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error('无法启动图片处理'))
      }
    })
  })
  preparationTail = task.then(
    () => undefined,
    () => undefined,
  )
  return task
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
