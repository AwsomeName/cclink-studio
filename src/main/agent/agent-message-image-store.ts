import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentMessageImageAsset,
  ImageAttachmentMediaType,
  TransientImageAttachment,
} from '../../shared/image-attachment'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MEDIA_TYPES: Record<string, ImageAttachmentMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Conversation-scoped immutable files. Only opaque references enter message snapshots. */
export class AgentMessageImageStore {
  constructor(private readonly root: string) {}

  async save(
    conversationId: string,
    images: TransientImageAttachment[],
  ): Promise<AgentMessageImageAsset[]> {
    if (images.length > 5) throw new Error('每次最多保存 5 张图片')
    const directory = this.directory(conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await this.assertDirectory(directory)
    await chmod(this.root, 0o700)
    await chmod(directory, 0o700)
    const assets: AgentMessageImageAsset[] = []
    for (const image of images) {
      const extension = Object.keys(MEDIA_TYPES).find((key) => MEDIA_TYPES[key] === image.mediaType)
      const bytes = Buffer.from(image.data, 'base64')
      if (
        !extension ||
        bytes.length === 0 ||
        bytes.length > MAX_IMAGE_BYTES ||
        bytes.length !== image.size
      ) {
        throw new Error('图片附件格式或大小无效')
      }
      const assetId = `${imageDigest(image.mediaType, bytes)}.${extension}`
      const temporary = join(directory, `.image-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        await rename(temporary, join(directory, assetId))
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      assets.push({ id: image.id, assetId })
    }
    return assets
  }

  async read(conversationId: string, assetId: string): Promise<string> {
    const match = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/.exec(assetId)
    if (!match) throw new Error('图片附件引用无效')
    const directory = this.directory(conversationId)
    await this.assertDirectory(directory)
    const file = await open(join(directory, assetId), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) {
        throw new Error('图片附件大小无效')
      }
      const bytes = await file.readFile()
      const mediaType = MEDIA_TYPES[match[2]]
      if (bytes.length !== info.size || imageDigest(mediaType, bytes) !== match[1]) {
        throw new Error('图片附件内容校验失败')
      }
      return `data:${mediaType};base64,${bytes.toString('base64')}`
    } finally {
      await file.close()
    }
  }

  private directory(conversationId: string): string {
    if (!conversationId || conversationId.length > 512) throw new Error('会话标识无效')
    return join(this.root, createHash('sha256').update(conversationId).digest('hex'))
  }

  private async assertDirectory(directory: string): Promise<void> {
    for (const path of [this.root, directory]) {
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('图片附件目录无效')
    }
  }
}

function imageDigest(mediaType: string, bytes: Buffer): string {
  return createHash('sha256').update(mediaType).update('\0').update(bytes).digest('hex')
}
