import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import {
  imageMimeTypeForExtension,
  isImageFileExtension,
  isAudioFileExtension,
  isVideoFileExtension,
  mediaMimeTypeForExtension,
} from '../../shared/file-types'
import {
  parseMediaProjectAsset,
  parseMediaProjectId,
} from '../../shared/media-production/media-project-schema'
import type {
  ImportMediaProjectAssetInput,
  MediaProject,
  MediaProjectAsset,
  MediaProjectAssetImportResult,
  MediaProjectFailure,
} from '../../shared/media-production/media-project-types'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'

const MEDIA_PROJECT_DIRECTORY = join('.cclink-studio', 'media-projects')
const MAX_ASSET_BYTES = 500 * 1024 * 1024

export class MediaAssetService {
  private mutationQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    private readonly now: () => number = Date.now,
  ) {}

  async importAsset(input: ImportMediaProjectAssetInput): Promise<MediaProjectAssetImportResult> {
    return this.enqueue(async () => {
      try {
        const sourcePath = await realpath(resolve(input.sourcePath))
        const sourceStat = await stat(sourcePath)
        const extension = extname(sourcePath).toLowerCase()
        const media = mediaDescriptor(extension)
        if (!sourceStat.isFile() || !media || sourceStat.size > MAX_ASSET_BYTES) {
          return failure(
            'MEDIA_PROJECT_ASSET_UNSUPPORTED',
            '只支持不超过 500 MB 的常见图片、视频或音频素材',
            '选择常见图片、视频、mp3、wav、m4a、aac、ogg 或 flac 文件后重试',
          )
        }
        const directory = await this.resolveAssetDirectory(input.workspacePath, input.projectId)
        const sha256 = await hashFile(sourcePath)
        const existing = await this.findExisting(directory, sha256)
        if (existing) return { success: true, asset: existing }

        const id = randomUUID()
        const destinationPath = join(directory, `${id}${extension}`)
        await copyFile(sourcePath, destinationPath)
        const asset: MediaProjectAsset = {
          id,
          kind: media.kind,
          source: 'local-import',
          fileName: basename(sourcePath),
          path: destinationPath,
          mimeType: media.mimeType,
          sizeBytes: sourceStat.size,
          sha256,
          provenance: { originalPath: sourcePath },
          addedAt: this.now(),
        }
        await this.appendManifest(directory, asset)
        return { success: true, asset }
      } catch (error) {
        console.warn('[MediaAssetService] 素材导入失败:', error)
        return failure(
          'MEDIA_PROJECT_ASSET_IMPORT_FAILED',
          error instanceof Error ? error.message : '本地素材导入失败',
          '确认文件仍可读取且工作空间磁盘空间充足后重试',
        )
      }
    })
  }

  async storeGeneratedImage(input: {
    workspacePath: string
    projectId: string
    content: Buffer
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    fileName: string
    provider: string
    model: string
    taskId: string
    prompt: string
  }): Promise<MediaProjectAsset> {
    return this.enqueue(async () => {
      if (input.content.length > MAX_ASSET_BYTES) throw new Error('生成图片超过 500 MB')
      const directory = await this.resolveAssetDirectory(input.workspacePath, input.projectId)
      const sha256 = createHash('sha256').update(input.content).digest('hex')
      const existing = await this.findExisting(directory, sha256)
      if (existing) return existing
      const id = randomUUID()
      const extension = extensionForImageMimeType(input.mimeType)
      const destinationPath = join(directory, `${id}${extension}`)
      await writeFile(destinationPath, input.content)
      const asset: MediaProjectAsset = {
        id,
        kind: 'image',
        source: 'generated-image',
        fileName: `${input.fileName}${extension}`,
        path: destinationPath,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        sha256,
        provenance: {
          provider: input.provider,
          model: input.model,
          taskId: input.taskId,
          prompt: input.prompt,
        },
        addedAt: this.now(),
      }
      await this.appendManifest(directory, asset)
      return asset
    })
  }

  async storeSearchAsset(input: {
    workspacePath: string
    projectId: string
    content: Buffer
    extension: string
    kind: 'image' | 'video'
    mimeType: string
    fileName: string
    provider: string
    remoteId: string
    sourceUrl: string
    author: string
    authorUrl: string
    licenseSummary: string
  }): Promise<MediaProjectAsset> {
    return this.enqueue(async () => {
      if (input.content.length > MAX_ASSET_BYTES) throw new Error('搜索素材超过 500 MB')
      const directory = await this.resolveAssetDirectory(input.workspacePath, input.projectId)
      const sha256 = createHash('sha256').update(input.content).digest('hex')
      const existing = await this.findExisting(directory, sha256)
      if (existing) return existing
      const id = randomUUID()
      const destinationPath = join(directory, `${id}${input.extension}`)
      await writeFile(destinationPath, input.content)
      const asset: MediaProjectAsset = {
        id,
        kind: input.kind,
        source: 'search',
        fileName: input.fileName,
        path: destinationPath,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        sha256,
        provenance: {
          provider: input.provider,
          remoteId: input.remoteId,
          sourceUrl: input.sourceUrl,
          author: input.author,
          authorUrl: input.authorUrl,
          licenseSummary: input.licenseSummary,
          downloadedAt: this.now(),
        },
        addedAt: this.now(),
      }
      await this.appendManifest(directory, asset)
      return asset
    })
  }

  async storeGeneratedVideo(input: {
    workspacePath: string
    projectId: string
    content: Buffer
    provider: string
    model: string
    taskId: string
    prompt: string
  }): Promise<MediaProjectAsset> {
    return this.enqueue(async () => {
      if (input.content.length > MAX_ASSET_BYTES) throw new Error('生成视频超过 500 MB')
      const directory = await this.resolveAssetDirectory(input.workspacePath, input.projectId)
      const sha256 = createHash('sha256').update(input.content).digest('hex')
      const existing = await this.findExisting(directory, sha256)
      if (existing) return existing
      const id = randomUUID()
      const destinationPath = join(directory, `${id}.mp4`)
      await writeFile(destinationPath, input.content)
      const asset: MediaProjectAsset = {
        id,
        kind: 'video',
        source: 'generated-video',
        fileName: `generated-${input.taskId}.mp4`,
        path: destinationPath,
        mimeType: 'video/mp4',
        sizeBytes: input.content.length,
        sha256,
        provenance: {
          provider: input.provider,
          model: input.model,
          taskId: input.taskId,
          prompt: input.prompt,
        },
        addedAt: this.now(),
      }
      await this.appendManifest(directory, asset)
      return asset
    })
  }

  async validateProjectAssets(workspacePath: string, project: MediaProject): Promise<void> {
    const directory = await this.resolveAssetDirectory(workspacePath, project.id)
    for (const asset of project.assets ?? []) {
      const parsed = parseMediaProjectAsset(asset)
      const assetPath = resolve(parsed.path)
      if (!isPathWithin(assetPath, directory))
        throw new Error(`素材 ${asset.fileName} 不属于当前工程`)
      const assetStat = await stat(assetPath).catch(() => null)
      if (!assetStat?.isFile() || assetStat.size !== parsed.sizeBytes) {
        throw new Error(`素材 ${asset.fileName} 已丢失或被替换`)
      }
    }
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => undefined)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async resolveAssetDirectory(workspacePath: string, projectId: string): Promise<string> {
    parseMediaProjectId(projectId)
    const resolved = await this.workspaceStateService.resolveLocalWorkspace(workspacePath)
    if (!resolved.valid || !resolved.workspacePath) throw new Error('当前本地工作空间不可用')
    if (!(await this.workspaceStateService.getLocalProjectId(resolved.workspacePath))) {
      throw new Error('当前工作空间不可写')
    }
    const workspaceRealPath = await realpath(resolved.workspacePath)
    const projectDirectory = join(workspaceRealPath, MEDIA_PROJECT_DIRECTORY, projectId)
    const projectFile = await stat(join(projectDirectory, 'project.json')).catch(() => null)
    if (!projectFile?.isFile()) throw new Error('宣发视频工程不存在')
    const directory = join(projectDirectory, 'assets')
    await mkdir(directory, { recursive: true })
    const directoryRealPath = await realpath(directory)
    if (!isPathWithin(directoryRealPath, workspaceRealPath)) {
      throw new Error('工程素材目录越过工作空间边界，已拒绝写入')
    }
    return directoryRealPath
  }

  private async findExisting(directory: string, sha256: string): Promise<MediaProjectAsset | null> {
    const assets = await this.readManifest(directory)
    const existing = assets.find((asset) => asset.sha256 === sha256)
    if (!existing) return null
    const existingStat = await stat(existing.path).catch(() => null)
    return existingStat?.isFile() && existingStat.size === existing.sizeBytes ? existing : null
  }

  private async readManifest(directory: string): Promise<MediaProjectAsset[]> {
    try {
      const value = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf-8'))
      if (!Array.isArray(value)) throw new Error('素材 manifest 不是数组')
      return value.map((asset, index) => parseMediaProjectAsset(asset, index))
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  private async appendManifest(directory: string, asset: MediaProjectAsset): Promise<void> {
    const manifest = await this.readManifest(directory)
    const path = join(directory, 'manifest.json')
    const temporaryPath = `${path}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify([...manifest, asset], null, 2)}\n`, 'utf-8')
    await rename(temporaryPath, path)
  }
}

function mediaDescriptor(extension: string): {
  kind: MediaProjectAsset['kind']
  mimeType: string
} | null {
  if (isImageFileExtension(extension)) {
    const mimeType = imageMimeTypeForExtension(extension)
    return mimeType ? { kind: 'image', mimeType } : null
  }
  if (isVideoFileExtension(extension)) {
    const mimeType = mediaMimeTypeForExtension(extension)
    return mimeType ? { kind: 'video', mimeType } : null
  }
  if (isAudioFileExtension(extension)) {
    const mimeType = mediaMimeTypeForExtension(extension)
    return mimeType ? { kind: 'audio', mimeType } : null
  }
  return null
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function extensionForImageMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  throw new Error(`不支持的生成图片类型: ${mimeType}`)
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  const target = resolve(targetPath)
  const root = resolve(rootPath)
  return target === root || target.startsWith(`${root}${sep}`)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function failure(
  code: MediaProjectFailure['code'],
  message: string,
  recovery: string,
): MediaProjectAssetImportResult {
  return { success: false, error: { code, message, recovery } }
}
