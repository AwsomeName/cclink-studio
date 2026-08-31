import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { constants as fsConstants, createWriteStream, watch } from 'fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join, resolve, extname, dirname, parse, sep, basename, relative, isAbsolute } from 'path'
import { pipeline } from 'stream/promises'
import { shell } from 'electron'
import { createHash, randomUUID } from 'crypto'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { XMLParser } from 'fast-xml-parser'
import {
  imageMimeTypeForExtension,
  isAppleIWorkFileExtension,
  isArchiveFileExtension,
  isBinaryFileExtension,
  isImageFileExtension,
  isMediaFileExtension,
  isNativeMediaPreviewFileExtension,
  isOfficeFileExtension,
  isVideoFileExtension,
  mediaMimeTypeForExtension,
} from '../../shared/file-types'
import type {
  FsDocumentAssetResult,
  FsCopyEntryInput,
  FsCopyEntryResult,
  FsExtractZipResult,
  FsOfficePreviewBlock,
  FsRenderResult,
  FsSaveTextDocumentResult,
  FsSearchWorkspaceInput,
  FsSearchWorkspaceResult,
  FsTextDocumentSnapshot,
} from '../../shared/ipc/fs'
import { isMarkdownDocumentPath, markdownAssetDirectoryName } from '../../shared/markdown-document'
import { MarkdownDocumentService } from './markdown-document-service'

const MAX_INLINE_VIDEO_BYTES = 300 * 1024 * 1024
const MAX_OFFICE_PREVIEW_BLOCKS = 400
const MAX_OFFICE_TABLE_ROWS = 80
const MAX_PPTX_SLIDES = 120
const MAX_PPTX_LINES_PER_SLIDE = 80
const MAX_ZIP_TEXT_ENTRY_BYTES = 12 * 1024 * 1024
const OOXML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: false,
})

const FILE_PICKER_CAPABILITY_TTL_MS = 2 * 60 * 1000
const FILE_PICKER_CAPABILITY_MAX_USES = 32
const SEARCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
])
const DEFAULT_SEARCH_RESULT_LIMIT = 200

export interface FileAccessContext {
  rendererId?: number
  trustedWorkspace?: {
    kind: 'local' | 'remote' | 'global'
    rootPath?: string
  }
}

export interface FileServiceOptions {
  getActiveWorkspace: () => string | null
  now?: () => number
}

interface PickerCapability {
  path: string
  kind: 'workspace' | 'file-read' | 'file-write'
  expiresAt: number
  remainingUses: number
}

type FileAccessIntent = 'read' | 'write'

/**
 * 文件系统操作服务
 * 提供安全的文件读写能力，限制在工作区目录内
 */
export class FileService {
  private readonly markdownDocuments: MarkdownDocumentService
  private readonly accessContexts = new AsyncLocalStorage<FileAccessContext>()
  private readonly pickerCapabilities = new Map<number, PickerCapability[]>()
  private readonly getActiveWorkspace: () => string | null
  private readonly now: () => number

  constructor(options: FileServiceOptions) {
    this.getActiveWorkspace = options.getActiveWorkspace
    this.now = options.now ?? Date.now
    this.markdownDocuments = new MarkdownDocumentService((filePath) => this.validatePath(filePath))
  }

  withAccess<T>(context: FileAccessContext, operation: () => T): T {
    return this.accessContexts.run(context, operation)
  }

  getCurrentAccessRoot(): string | null {
    const context = this.accessContexts.getStore()
    if (context?.trustedWorkspace?.kind === 'local' && context.trustedWorkspace.rootPath) {
      return resolve(context.trustedWorkspace.rootPath)
    }
    if (context?.trustedWorkspace) return null
    return this.getActiveWorkspace()
  }

  registerPickerSelection(
    rendererId: number,
    paths: string[],
    kind: PickerCapability['kind'],
  ): void {
    const expiresAt = this.now() + FILE_PICKER_CAPABILITY_TTL_MS
    const existing = this.getLivePickerCapabilities(rendererId)
    for (const selectedPath of paths) {
      const path = resolve(selectedPath)
      const previous = existing.find(
        (capability) => capability.path === path && capability.kind === kind,
      )
      if (previous) {
        previous.expiresAt = expiresAt
        previous.remainingUses = FILE_PICKER_CAPABILITY_MAX_USES
      } else {
        existing.push({
          path,
          kind,
          expiresAt,
          remainingUses: FILE_PICKER_CAPABILITY_MAX_USES,
        })
      }
    }
    this.pickerCapabilities.set(rendererId, existing)
  }

  canActivateWorkspace(rendererId: number, workspacePath: string): boolean {
    const candidate = resolve(workspacePath)
    const active = this.getActiveWorkspace()
    if (active && resolve(active) === candidate) return true
    return this.getLivePickerCapabilities(rendererId).some(
      (capability) => capability.kind === 'workspace' && capability.path === candidate,
    )
  }

  consumeWorkspaceActivation(rendererId: number, workspacePath: string): boolean {
    const candidate = resolve(workspacePath)
    const active = this.getActiveWorkspace()
    if (active && resolve(active) === candidate) return true
    const capabilities = this.getLivePickerCapabilities(rendererId)
    const index = capabilities.findIndex(
      (capability) => capability.kind === 'workspace' && capability.path === candidate,
    )
    if (index === -1) return false
    capabilities.splice(index, 1)
    this.pickerCapabilities.set(rendererId, capabilities)
    return true
  }

  /**
   * 安全校验：确保目标路径在允许的根目录下
   * 防止目录穿越攻击（如 ../../etc/passwd）和路径前缀攻击（如 /Users/testuser）
   */
  private async validatePath(
    targetPath: string,
    intent: FileAccessIntent = 'read',
  ): Promise<string> {
    const resolved = resolve(targetPath)
    const context = this.accessContexts.getStore()
    const trustedRoot =
      context?.trustedWorkspace?.kind === 'local' && context.trustedWorkspace.rootPath
        ? resolve(context.trustedWorkspace.rootPath)
        : context?.trustedWorkspace
          ? null
          : this.getActiveWorkspace()
            ? resolve(this.getActiveWorkspace()!)
            : null
    const pickerCapability = this.findPickerCapability(context?.rendererId, resolved, intent)
    if (!trustedRoot && !pickerCapability) {
      throw new Error('OUTSIDE_WORKSPACE: 当前操作没有可信本地工作空间或文件选择器授权')
    }
    const canonical = await canonicalizeExistingOrParent(resolved)
    if (trustedRoot && !pickerCapability) {
      const canonicalRoot = await realpath(trustedRoot)
      if (!isPathWithin(canonicalRoot, canonical)) {
        throw new Error(`OUTSIDE_WORKSPACE: 路径的真实目标不属于可信工作空间: ${resolved}`)
      }
    } else if (pickerCapability) {
      const canonicalCapability = await canonicalizeExistingOrParent(pickerCapability.path)
      const matchesCapability =
        pickerCapability.kind === 'workspace'
          ? isPathWithin(canonicalCapability, canonical)
          : canonical === canonicalCapability
      if (!matchesCapability) {
        throw new Error(`OUTSIDE_WORKSPACE: 文件选择器授权不匹配: ${resolved}`)
      }
    }
    if (pickerCapability) pickerCapability.remainingUses -= 1
    return resolved
  }

  private async validateWorkspaceTarget(
    workspacePath: string,
    targetPath: string,
    options: { allowWorkspaceRoot: boolean },
  ): Promise<{ workspacePath: string; targetPath: string }> {
    const safeWorkspacePath = await this.validatePath(workspacePath)
    const safeTargetPath = await this.validatePath(targetPath)
    const relativeTarget = relative(safeWorkspacePath, safeTargetPath)
    const isWithinWorkspace =
      relativeTarget === '' ||
      (relativeTarget !== '..' &&
        !relativeTarget.startsWith(`..${sep}`) &&
        !isAbsolute(relativeTarget))
    if (!isWithinWorkspace) throw new Error('目标路径不属于当前工作区')
    if (!options.allowWorkspaceRoot && relativeTarget === '') {
      throw new Error('不能从文件树删除工作区根目录')
    }
    return { workspacePath: safeWorkspacePath, targetPath: safeTargetPath }
  }

  private getLivePickerCapabilities(rendererId: number): PickerCapability[] {
    const live = (this.pickerCapabilities.get(rendererId) ?? []).filter(
      (capability) => capability.expiresAt > this.now() && capability.remainingUses > 0,
    )
    this.pickerCapabilities.set(rendererId, live)
    return live
  }

  private findPickerCapability(
    rendererId: number | undefined,
    targetPath: string,
    intent: FileAccessIntent,
  ): PickerCapability | null {
    if (rendererId === undefined) return null
    return (
      this.getLivePickerCapabilities(rendererId).find((capability) => {
        if (capability.kind === 'workspace') {
          return intent === 'read' && isPathWithin(capability.path, targetPath)
        }
        if (capability.path !== targetPath) return false
        return capability.kind === 'file-write' || intent === 'read'
      }) ?? null
    )
  }

  private async readAuthorizedFile(filePath: string): Promise<{
    path: string
    buffer: Buffer
    fileStat: Awaited<ReturnType<typeof stat>>
  }> {
    const safe = await this.validatePath(filePath, 'read')
    const before = await stat(safe)
    const handle = await open(safe, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
      const opened = await handle.stat()
      if (before.dev !== opened.dev || before.ino !== opened.ino) {
        throw new Error('OUTSIDE_WORKSPACE: 文件在安全检查后被替换')
      }
      const after = await stat(safe)
      if (after.dev !== opened.dev || after.ino !== opened.ino) {
        throw new Error('OUTSIDE_WORKSPACE: 文件路径在打开后发生变化')
      }
      await this.validatePath(safe, 'read')
      return { path: safe, buffer: await handle.readFile(), fileStat: opened }
    } finally {
      await handle.close()
    }
  }

  async assertReadableFile(filePath: string): Promise<string> {
    const safe = await this.validatePath(filePath, 'read')
    const before = await stat(safe)
    if (!before.isFile()) throw new Error('EINVAL: 目标不是文件')
    const handle = await open(safe, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino) {
        throw new Error('OUTSIDE_WORKSPACE: 文件在安全检查后被替换')
      }
      return safe
    } finally {
      await handle.close()
    }
  }

  async assertWritableTarget(filePath: string): Promise<string> {
    return this.validatePath(filePath, 'write')
  }

  private async writeAuthorizedFile(
    filePath: string,
    content: string,
    options: { exclusive?: boolean } = {},
  ): Promise<string> {
    const safe = await this.validatePath(filePath, 'write')
    await mkdir(dirname(safe), { recursive: true })
    await this.validatePath(safe, 'write')
    const parentBefore = await realpath(dirname(safe))
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_NOFOLLOW |
      (options.exclusive ? fsConstants.O_EXCL : fsConstants.O_TRUNC)
    const handle = await open(safe, flags, 0o600)
    try {
      const parentAfter = await realpath(dirname(safe))
      if (parentAfter !== parentBefore) {
        throw new Error('OUTSIDE_WORKSPACE: 目标父目录在打开过程中发生变化')
      }
      await this.validatePath(safe, 'write')
      await handle.writeFile(content, 'utf8')
      await handle.sync()
      return safe
    } finally {
      await handle.close()
    }
  }

  /** 读取目录内容（options.showHiddenFiles 为真时不过滤 . 开头的隐藏文件） */
  async readDir(dirPath: string, options?: { showHiddenFiles?: boolean }): Promise<DirEntry[]> {
    const safe = await this.validatePath(dirPath)
    const entries = await readdir(safe, { withFileTypes: true })

    return entries
      .filter((e) => options?.showHiddenFiles || !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: join(safe, e.name),
        type: e.isDirectory() ? ('directory' as const) : ('file' as const),
        extension: e.isFile() ? extname(e.name).toLowerCase() : undefined,
      }))
      .sort((a, b) => {
        // 目录优先，然后按名称排序
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  /** 主进程拥有的有界工作空间搜索；不跟随符号链接，且在扫描期间持续复核工作空间。 */
  async searchWorkspace(input: FsSearchWorkspaceInput): Promise<FsSearchWorkspaceResult> {
    const root = resolve(input.workspaceKey)
    const activeRoot = this.getCurrentAccessRoot()
    if (!activeRoot || resolve(activeRoot) !== root) {
      throw new Error('STALE_WORKSPACE: 搜索请求不属于当前工作空间')
    }
    const safeRoot = await this.validatePath(root)
    const canonicalRoot = await realpath(safeRoot)
    const query = input.query.trim().toLocaleLowerCase()
    const limit = input.maxResults ?? DEFAULT_SEARCH_RESULT_LIMIT
    const results: FsSearchWorkspaceResult['results'] = []
    let scannedEntries = 0
    let truncated = false
    const pending = [safeRoot]

    while (pending.length > 0) {
      const active = this.getCurrentAccessRoot()
      if (!active || resolve(active) !== root) {
        throw new Error('STALE_WORKSPACE: 搜索期间工作空间已切换')
      }
      const directory = pending.pop()!
      const canonicalDirectory = await realpath(directory)
      if (!isPathWithin(canonicalRoot, canonicalDirectory)) {
        throw new Error('OUTSIDE_WORKSPACE: 搜索目录逃逸工作空间')
      }
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        scannedEntries += 1
        const entryPath = join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        const type = entry.isDirectory() ? ('directory' as const) : ('file' as const)
        if (entry.name.toLocaleLowerCase().includes(query)) {
          if (results.length >= limit) {
            truncated = true
            break
          }
          results.push({
            name: entry.name,
            path: entryPath,
            type,
            extension: entry.isFile() ? extname(entry.name).toLowerCase() : undefined,
          })
        }
        if (entry.isDirectory() && !SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(entryPath)
        }
      }
      if (truncated) break
    }

    return { ...input, query: input.query.trim(), results, truncated, scannedEntries }
  }

  /** 读取文件内容 */
  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    const { path: safe, buffer } = await this.readAuthorizedFile(filePath)
    const ext = extname(safe).toLowerCase()

    // 二进制文件返回 base64，避免编辑器把模型/压缩包当 UTF-8 文本解析。
    if (isBinaryFileExtension(ext)) {
      return { content: buffer.toString('base64'), encoding: 'base64' }
    }

    return { content: buffer.toString('utf-8'), encoding: 'utf-8' }
  }

  async readTextDocument(filePath: string): Promise<FsTextDocumentSnapshot> {
    const { path: safe, buffer, fileStat } = await this.readAuthorizedFile(filePath)
    return textDocumentSnapshot(safe, buffer, Number(fileStat.mtimeMs))
  }

  /** 渲染只读文件预览。渲染进程只消费结构化结果，不直接读取本机文件。 */
  async renderFile(filePath: string): Promise<FsRenderResult> {
    const safe = await this.validatePath(filePath)
    const ext = extname(safe).toLowerCase()
    const parsed = parse(safe)

    const mimeType = imageMimeTypeForExtension(ext)
    if (isImageFileExtension(ext) && mimeType) {
      const buffer = await readFile(safe)
      return {
        kind: 'image',
        content: buffer.toString('base64'),
        encoding: 'base64',
        mimeType,
        fileName: parsed.base,
        path: safe,
      }
    }

    if (ext === '.pdf') {
      const buffer = await readFile(safe)
      return {
        kind: 'pdf',
        content: buffer.toString('base64'),
        encoding: 'base64',
        mimeType: 'application/pdf',
        fileName: parsed.base,
        path: safe,
      }
    }

    if (isMediaFileExtension(ext)) {
      const playable = isNativeMediaPreviewFileExtension(ext)
      const mediaMimeType = mediaMimeTypeForExtension(ext)
      const fileStat = await stat(safe)
      const videoTooLarge = isVideoFileExtension(ext) && fileStat.size > MAX_INLINE_VIDEO_BYTES
      return {
        kind: 'media',
        mediaKind: isVideoFileExtension(ext) ? 'video' : 'audio',
        playable: playable && !videoTooLarge,
        ...(playable && !videoTooLarge
          ? {
              content: (await readFile(safe)).toString('base64'),
              encoding: 'base64' as const,
            }
          : {}),
        mimeType: mediaMimeType,
        fileName: parsed.base,
        path: safe,
        ...(playable && !videoTooLarge
          ? {}
          : {
              reason: videoTooLarge
                ? '视频超过 300MB，本地内嵌预览暂不加载。可用系统播放器打开，或后续改为流式预览。'
                : '该媒体格式未纳入本轮内嵌预览。可用系统播放器打开，或转码为 mp4/mov/webm/m4v 后预览。',
            }),
      }
    }

    if (ext === '.docx') {
      return renderDocxPreview(safe, parsed.base)
    }

    if (ext === '.pptx') {
      return renderPptxPreview(safe, parsed.base)
    }

    if (isOfficeFileExtension(ext)) {
      return {
        kind: 'unsupported',
        reason:
          '该 Office/OpenDocument 文件暂不做内置预览。docx/pptx 已支持只读内容预览，完整所见即所得编辑后续单独设计。',
        fileName: parsed.base,
        path: safe,
      }
    }

    if (ext === '.zip') {
      return {
        kind: 'unsupported',
        reason: 'zip 文件不做内置预览。请在文件树中右键选择“解压到同名文件夹”。',
        fileName: parsed.base,
        path: safe,
      }
    }

    if (isAppleIWorkFileExtension(ext)) {
      return {
        kind: 'unsupported',
        reason:
          'Apple iWork 文件当前不内置解析器。请用系统应用打开，或导出为 docx/xlsx/pptx 后再预览。',
        fileName: parsed.base,
        path: safe,
      }
    }

    if (isArchiveFileExtension(ext)) {
      return {
        kind: 'unsupported',
        reason: '该压缩格式本轮不做内置预览。可用系统应用打开，或转换为 zip 后使用右键解压。',
        fileName: parsed.base,
        path: safe,
      }
    }

    return {
      kind: 'unsupported',
      reason: '此文件类型暂无内置预览器。可用系统默认应用打开，或发送到会话让 Agent 按路径处理。',
      fileName: parsed.base,
      path: safe,
    }
  }

  /** 解压 zip 到同级同名目录；自动避开重名目录，并阻止 zip slip 路径穿越。 */
  async extractZip(filePath: string): Promise<FsExtractZipResult> {
    const safe = await this.validatePath(filePath)
    if (extname(safe).toLowerCase() !== '.zip') {
      throw new Error('仅支持解压 .zip 文件')
    }

    const targetDir = await uniqueExtractDir(dirname(safe), basename(safe, extname(safe)))
    await mkdir(targetDir, { recursive: true })
    const extracted = await extractZipToDirectory(safe, targetDir)
    return { targetDir, extracted }
  }

  /** 写入文件 */
  async writeFile(filePath: string, content: string): Promise<void> {
    await this.writeAuthorizedFile(filePath, content)
  }

  /** 新建空文件；目标已存在时拒绝，避免文件树“新建”静默截断原文件。 */
  async createFile(filePath: string): Promise<void> {
    await this.writeAuthorizedFile(filePath, '', { exclusive: true })
  }

  async saveTextDocument(input: {
    filePath: string
    content: string
    expectedHash?: string
    force?: boolean
  }): Promise<FsSaveTextDocumentResult> {
    const safe = await this.validatePath(input.filePath, 'write')
    await mkdir(dirname(safe), { recursive: true })

    const current = await readTextDocumentIfExists(safe)
    if (!input.force && input.expectedHash !== undefined && current?.hash !== input.expectedHash) {
      return { status: 'conflict', current }
    }

    const prepared = isMarkdownDocumentPath(safe)
      ? await this.markdownDocuments.prepareSave(safe, input.content)
      : null
    const content = prepared?.content ?? input.content
    const tempPath = join(dirname(safe), `.${basename(safe)}.${randomUUID()}.tmp`)
    try {
      await writeFile(tempPath, content, 'utf-8')
      await rename(tempPath, safe)
      if (prepared) await this.markdownDocuments.finalizeSave(prepared)
    } catch (error) {
      await unlink(tempPath).catch(() => {})
      throw error
    }

    return { status: 'saved', snapshot: await this.readTextDocument(safe) }
  }

  async importDocumentAsset(
    documentPath: string,
    sourcePath: string,
  ): Promise<FsDocumentAssetResult> {
    const safeDocument = await this.validatePath(documentPath, 'write')
    const safeSource = await this.validatePath(sourcePath)
    const extension = extname(safeSource).toLowerCase()
    if (!isImageFileExtension(extension)) {
      throw new Error('仅支持导入图片资源')
    }
    return this.markdownDocuments.importAsset(safeDocument, safeSource)
  }

  async saveDocumentAsset(input: {
    documentPath: string
    fileName: string
    mimeType: string
    content: string
    encoding: 'base64'
  }): Promise<FsDocumentAssetResult> {
    const safeDocument = await this.validatePath(input.documentPath, 'write')
    if (input.encoding !== 'base64' || !input.mimeType.startsWith('image/')) {
      throw new Error('仅支持 base64 图片资源')
    }
    const extension = imageExtensionForMimeType(input.mimeType)
    if (!extension) throw new Error(`不支持的图片类型: ${input.mimeType}`)
    const requestedName = basename(input.fileName || `image-${Date.now()}${extension}`)
    const fileName = extname(requestedName) ? requestedName : `${requestedName}${extension}`
    return this.markdownDocuments.saveAsset(
      safeDocument,
      fileName,
      Buffer.from(input.content, 'base64'),
    )
  }

  async applyMarkdownIllustrations(input: {
    documentPath: string
    expectedHash: string
    illustrations: Array<{
      fileName: string
      mimeType: string
      content: Buffer
      alt: string
      anchorText?: string
      placement: 'before' | 'after' | 'end'
    }>
  }): Promise<{
    snapshot: FsTextDocumentSnapshot
    assets: FsDocumentAssetResult[]
  }> {
    const safeDocument = await this.validatePath(input.documentPath, 'write')
    if (!isMarkdownDocumentPath(safeDocument)) {
      throw new Error('自动配图仅支持 Markdown 文档')
    }
    if (input.illustrations.length === 0) throw new Error('至少需要一张插图')
    const current = await this.readTextDocument(safeDocument)
    if (current.hash !== input.expectedHash) {
      throw new Error('Markdown 文档已发生变化，请重新读取后再配图')
    }
    preflightMarkdownIllustrationAnchors(current.content, input.illustrations)

    const assets: FsDocumentAssetResult[] = []
    try {
      for (const illustration of input.illustrations) {
        const extension = imageExtensionForMimeType(illustration.mimeType)
        if (!extension) throw new Error(`不支持的生成图片类型: ${illustration.mimeType}`)
        const requestedName = extname(illustration.fileName)
          ? illustration.fileName
          : `${illustration.fileName}${extension}`
        assets.push(
          await this.markdownDocuments.saveAsset(safeDocument, requestedName, illustration.content),
        )
      }

      const content = insertMarkdownIllustrations(
        current.content,
        input.illustrations.map((illustration, index) => ({
          ...illustration,
          relativePath: assets[index].relativePath,
        })),
      )
      const result = await this.saveTextDocument({
        filePath: safeDocument,
        content,
        expectedHash: current.hash,
      })
      if (result.status !== 'saved') {
        throw new Error('Markdown 文档已发生变化，未插入生成图片')
      }
      return { snapshot: result.snapshot, assets }
    } catch (error) {
      await this.markdownDocuments
        .removeAssets(
          safeDocument,
          assets.map((asset) => asset.path),
        )
        .catch((rollbackError) => {
          console.error('[FileService] 自动配图资源回滚失败:', rollbackError)
        })
      throw error
    }
  }

  async preflightMarkdownIllustrations(input: {
    documentPath: string
    expectedHash?: string
    illustrations: Array<{
      anchorText?: string
      placement: 'before' | 'after' | 'end'
    }>
  }): Promise<FsTextDocumentSnapshot> {
    const safeDocument = await this.validatePath(input.documentPath)
    if (!isMarkdownDocumentPath(safeDocument)) {
      throw new Error('自动配图仅支持 Markdown 文档')
    }
    const current = await this.readTextDocument(safeDocument)
    if (input.expectedHash && current.hash !== input.expectedHash) {
      throw new Error('Markdown 文档已发生变化，请重新读取后再配图')
    }
    preflightMarkdownIllustrationAnchors(current.content, input.illustrations)
    return current
  }

  async inspectMarkdownDocument(documentPath: string) {
    const safe = await this.validatePath(documentPath)
    if (!isMarkdownDocumentPath(safe)) throw new Error('仅支持检查 Markdown 文档')
    return this.markdownDocuments.inspect(safe)
  }

  async saveMarkdownDocumentAs(input: {
    sourcePath?: string
    targetPath: string
    content: string
  }) {
    const sourcePath = input.sourcePath ? await this.validatePath(input.sourcePath) : undefined
    const targetPath = await this.validatePath(input.targetPath, 'write')
    if (!isMarkdownDocumentPath(targetPath)) throw new Error('目标必须是 Markdown 文件')
    return this.markdownDocuments.saveAs({
      sourcePath,
      targetPath,
      content: input.content,
      save: async (filePath, content) => {
        const result = await this.saveTextDocument({ filePath, content, force: true })
        if (result.status !== 'saved') throw new Error('另存为时发生文件冲突')
        return result.snapshot
      },
    })
  }

  async relocateMarkdownDocument(input: { sourcePath: string; targetPath: string }) {
    const sourcePath = await this.validatePath(input.sourcePath, 'write')
    const targetPath = await this.validatePath(input.targetPath, 'write')
    if (!isMarkdownDocumentPath(sourcePath) || !isMarkdownDocumentPath(targetPath)) {
      throw new Error('仅支持移动或重命名 Markdown 文档资源组')
    }
    return this.markdownDocuments.relocate({
      sourcePath,
      targetPath,
      save: async (filePath, content) => {
        const result = await this.saveTextDocument({ filePath, content, force: true })
        if (result.status !== 'saved') throw new Error('移动文档时发生文件冲突')
        return result.snapshot
      },
    })
  }

  async exportMarkdownDocumentZip(input: { documentPath: string; targetPath: string }) {
    const documentPath = await this.validatePath(input.documentPath)
    const targetPath = await this.validatePath(input.targetPath, 'write')
    if (!isMarkdownDocumentPath(documentPath)) throw new Error('仅支持导出 Markdown 文档')
    if (extname(targetPath).toLowerCase() !== '.zip')
      throw new Error('导出文件必须使用 .zip 扩展名')
    const current = await this.readTextDocument(documentPath)
    const saved = await this.saveTextDocument({
      filePath: documentPath,
      content: current.content,
      expectedHash: current.hash,
      force: true,
    })
    if (saved.status !== 'saved') throw new Error('导出前保存 Markdown 资源组失败')
    return this.markdownDocuments.exportZip(documentPath, targetPath)
  }

  async trashMarkdownDocument(input: {
    workspacePath: string
    documentPath: string
    includeAssets: boolean
  }) {
    const { targetPath: documentPath } = await this.validateWorkspaceTarget(
      input.workspacePath,
      input.documentPath,
      { allowWorkspaceRoot: false },
    )
    if (!isMarkdownDocumentPath(documentPath)) throw new Error('仅支持删除 Markdown 文档资源组')
    const resourceDirectories = input.includeAssets
      ? await this.markdownDocuments.existingResourceDirectories(documentPath)
      : []
    const trashedPaths: string[] = []
    const failedPaths: string[] = []
    await shell.trashItem(documentPath)
    trashedPaths.push(documentPath)
    for (const resourcePath of resourceDirectories) {
      try {
        await shell.trashItem(resourcePath)
        trashedPaths.push(resourcePath)
      } catch {
        failedPaths.push(resourcePath)
      }
    }
    return { trashedPaths, failedPaths }
  }

  async trashPath(input: { workspacePath: string; targetPath: string }) {
    const { targetPath } = await this.validateWorkspaceTarget(
      input.workspacePath,
      input.targetPath,
      {
        allowWorkspaceRoot: false,
      },
    )
    await shell.trashItem(targetPath)
    return { trashedPath: targetPath }
  }

  async revealPath(input: { workspacePath: string; targetPath: string }): Promise<void> {
    const { targetPath } = await this.validateWorkspaceTarget(
      input.workspacePath,
      input.targetPath,
      {
        allowWorkspaceRoot: true,
      },
    )
    shell.showItemInFolder(targetPath)
  }

  async openPath(targetPath: string): Promise<void> {
    const safe = await this.validatePath(targetPath)
    const error = await shell.openPath(safe)
    if (error) throw new Error(error)
  }

  /** 获取文件/目录元数据 */
  async stat(filePath: string): Promise<FileStat> {
    const safe = await this.validatePath(filePath)
    const s = await stat(safe)
    const parsed = parse(safe)

    return {
      name: parsed.base,
      path: safe,
      type: s.isDirectory() ? 'directory' : 'file',
      extension: s.isFile() ? extname(safe).toLowerCase() : undefined,
      size: s.size,
      modifiedAt: s.mtimeMs,
      createdAt: s.birthtimeMs,
    }
  }

  /** 安静检查路径是否为目录，用于最近项目恢复等探测场景 */
  async isDirectory(dirPath: string): Promise<boolean> {
    try {
      const safe = await this.validatePath(dirPath)
      const s = await stat(safe)
      return s.isDirectory()
    } catch {
      return false
    }
  }

  /** 创建目录 */
  async mkdir(dirPath: string): Promise<void> {
    const safe = await this.validatePath(dirPath, 'write')
    await mkdir(safe, { recursive: true })
  }

  /** 重命名/移动文件 */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const safeOld = await this.validatePath(oldPath, 'write')
    const safeNew = await this.validatePath(newPath, 'write')
    if (safeOld === safeNew) return
    const targetParent = await stat(dirname(safeNew))
    if (!targetParent.isDirectory()) throw new Error('ENOTDIR: 重命名目标不是文件夹')
    try {
      await stat(safeNew)
      throw new Error('EEXIST: 目标文件夹中已存在同名文件或文件夹')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(safeOld, safeNew)
  }

  /** 移动文件/目录，不允许覆盖目标中的同名项。 */
  async move(oldPath: string, newPath: string): Promise<void> {
    const safeOld = await this.validatePath(oldPath, 'write')
    const safeNew = await this.validatePath(newPath, 'write')
    if (safeOld === safeNew) return

    const source = await stat(safeOld)
    const targetParent = await stat(dirname(safeNew))
    if (!targetParent.isDirectory()) throw new Error('ENOTDIR: 移动目标不是文件夹')
    if (source.isDirectory()) {
      const nestedPath = relative(safeOld, safeNew)
      if (nestedPath && nestedPath !== '..' && !nestedPath.startsWith(`..${sep}`)) {
        throw new Error('EINVAL: 文件夹不能移动到自身或其子目录')
      }
    }

    try {
      await stat(safeNew)
      throw new Error('EEXIST: 目标文件夹中已存在同名文件或文件夹')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(safeOld, safeNew)
  }

  /** 复制文件或目录；目标同名时生成不覆盖的“副本”名称。 */
  async copyEntry(input: FsCopyEntryInput): Promise<FsCopyEntryResult> {
    const sourceScope = await this.validateWorkspaceTarget(
      input.sourceWorkspacePath,
      input.sourcePath,
      {
        allowWorkspaceRoot: true,
      },
    )
    const targetScope = await this.validateWorkspaceTarget(
      input.targetWorkspacePath,
      input.targetDirectory,
      { allowWorkspaceRoot: true },
    )
    if (sourceScope.targetPath === sourceScope.workspacePath) {
      throw new Error('不能复制工作区根目录')
    }

    const [sourceStat, targetStat] = await Promise.all([
      lstat(sourceScope.targetPath),
      stat(targetScope.targetPath),
    ])
    if (!targetStat.isDirectory()) throw new Error('ENOTDIR: 粘贴目标不是文件夹')
    if (
      sourceStat.isDirectory() &&
      (targetScope.targetPath === sourceScope.targetPath ||
        targetScope.targetPath.startsWith(`${sourceScope.targetPath}${sep}`))
    ) {
      throw new Error('EINVAL: 文件夹不能复制到自身或其子目录')
    }

    const markdownDocument = sourceStat.isFile() && isMarkdownDocumentPath(sourceScope.targetPath)
    const destinationPath = markdownDocument
      ? await uniqueMarkdownCopyPath(targetScope.targetPath, basename(sourceScope.targetPath))
      : await uniqueCopyPath(
          targetScope.targetPath,
          basename(sourceScope.targetPath),
          sourceStat.isDirectory(),
        )
    if (markdownDocument) {
      const source = await this.readTextDocument(sourceScope.targetPath)
      await this.saveMarkdownDocumentAs({
        sourcePath: sourceScope.targetPath,
        targetPath: destinationPath,
        content: source.content,
      })
      return {
        sourcePath: sourceScope.targetPath,
        destinationPath,
      }
    }
    try {
      await cp(sourceScope.targetPath, destinationPath, {
        recursive: sourceStat.isDirectory(),
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        await rm(destinationPath, { recursive: true, force: true }).catch(() => {})
      }
      throw error
    }
    return {
      sourcePath: sourceScope.targetPath,
      destinationPath,
    }
  }

  /** 删除文件 */
  async delete(filePath: string): Promise<void> {
    const safe = await this.validatePath(filePath, 'write')
    await unlink(safe)
  }

  /** 监听目录变更 */
  async watchDir(
    dirPath: string,
    onChange: (event: 'add' | 'change' | 'unlink', filePath: string) => void,
  ): Promise<{ stop: () => void }> {
    const safe = await this.validatePath(dirPath)
    const watcher = watch(safe, { recursive: true }, (event, filename) => {
      if (filename) {
        onChange(event === 'rename' ? 'add' : 'change', join(safe, filename))
      }
    })
    return {
      stop: () => watcher.close(),
    }
  }
}

/** 目录条目 */
export interface DirEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
}

/** 文件元数据 */
export interface FileStat {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  size: number
  modifiedAt: number
  createdAt: number
}

async function canonicalizeExistingOrParent(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let existingParent = dirname(targetPath)
  while (true) {
    try {
      const canonicalParent = await realpath(existingParent)
      const suffix = relative(existingParent, targetPath)
      return resolve(canonicalParent, suffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const next = dirname(existingParent)
      if (next === existingParent) throw error
      existingParent = next
    }
  }
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const fromRoot = relative(resolve(rootPath), resolve(candidatePath))
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

async function uniqueExtractDir(parentDir: string, baseName: string): Promise<string> {
  const safeBaseName = baseName.trim() || 'archive'
  let candidate = join(parentDir, safeBaseName)
  let index = 1
  while (await pathExists(candidate)) {
    candidate = join(parentDir, `${safeBaseName}-${index}`)
    index += 1
  }
  return candidate
}

async function uniqueCopyPath(
  targetDirectory: string,
  sourceName: string,
  isDirectory: boolean,
): Promise<string> {
  const original = join(targetDirectory, sourceName)
  if (!(await entryExists(original))) return original

  const parsed = isDirectory ? { name: sourceName, ext: '' } : parse(sourceName)
  let index = 1
  while (true) {
    const suffix = index === 1 ? ' 副本' : ` 副本 ${index}`
    const candidate = join(targetDirectory, `${parsed.name}${suffix}${parsed.ext}`)
    if (!(await entryExists(candidate))) return candidate
    index += 1
  }
}

async function uniqueMarkdownCopyPath(
  targetDirectory: string,
  sourceName: string,
): Promise<string> {
  const parsed = parse(sourceName)
  let index = 0
  while (true) {
    const suffix = index === 0 ? '' : index === 1 ? ' 副本' : ` 副本 ${index}`
    const candidate = join(targetDirectory, `${parsed.name}${suffix}${parsed.ext}`)
    const assetDirectory = join(targetDirectory, markdownAssetDirectoryName(candidate))
    if (!(await entryExists(candidate)) && !(await entryExists(assetDirectory))) return candidate
    index += 1
  }
}

async function entryExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readTextDocumentIfExists(filePath: string): Promise<FsTextDocumentSnapshot | null> {
  try {
    const [buffer, fileStat] = await Promise.all([readFile(filePath), stat(filePath)])
    return textDocumentSnapshot(filePath, buffer, fileStat.mtimeMs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function textDocumentSnapshot(
  filePath: string,
  buffer: Buffer,
  modifiedAt: number,
): FsTextDocumentSnapshot {
  return {
    path: filePath,
    content: buffer.toString('utf-8'),
    size: buffer.byteLength,
    modifiedAt,
    hash: createHash('sha256').update(buffer).digest('hex'),
  }
}

interface MarkdownIllustrationInsertion {
  alt: string
  relativePath: string
  anchorText?: string
  placement: 'before' | 'after' | 'end'
}

function preflightMarkdownIllustrationAnchors(
  source: string,
  illustrations: Array<{
    anchorText?: string
    placement: 'before' | 'after' | 'end'
  }>,
): void {
  for (const illustration of illustrations) {
    if (illustration.placement === 'end') continue
    const anchor = illustration.anchorText?.trim()
    if (!anchor) throw new Error('插图位置缺少 anchorText')
    const first = source.indexOf(anchor)
    if (first < 0) throw new Error(`未找到插图锚点: ${anchor.slice(0, 80)}`)
    if (source.indexOf(anchor, first + anchor.length) >= 0) {
      throw new Error(`插图锚点不唯一，请提供更长的附近文本: ${anchor.slice(0, 80)}`)
    }
  }
}

function insertMarkdownIllustrations(
  source: string,
  illustrations: MarkdownIllustrationInsertion[],
): string {
  preflightMarkdownIllustrationAnchors(source, illustrations)
  const grouped = new Map<number, string[]>()
  for (const illustration of illustrations) {
    const offset =
      illustration.placement === 'end'
        ? source.length
        : resolveMarkdownIllustrationOffset(
            source,
            illustration.anchorText!.trim(),
            illustration.placement,
          )
    const alt = illustration.alt.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
    const markdown = `![${alt}](<${illustration.relativePath.replace(/>/g, '%3E')}>)`
    grouped.set(offset, [...(grouped.get(offset) ?? []), markdown])
  }

  let content = source
  for (const [offset, markdownItems] of [...grouped.entries()].sort(([a], [b]) => b - a)) {
    const before = content.slice(0, offset)
    const after = content.slice(offset)
    const prefix =
      before.length === 0
        ? ''
        : before.endsWith('\n\n')
          ? ''
          : before.endsWith('\n')
            ? '\n'
            : '\n\n'
    const suffix =
      after.length === 0
        ? '\n'
        : after.startsWith('\n\n')
          ? ''
          : after.startsWith('\n')
            ? '\n'
            : '\n\n'
    content = `${before}${prefix}${markdownItems.join('\n\n')}${suffix}${after}`
  }
  return content
}

function resolveMarkdownIllustrationOffset(
  source: string,
  anchor: string,
  placement: 'before' | 'after',
): number {
  const index = source.indexOf(anchor)
  return placement === 'before' ? index : index + anchor.length
}

function imageExtensionForMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/svg+xml':
      return '.svg'
    case 'image/bmp':
      return '.bmp'
    default:
      return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function extractZipToDirectory(filePath: string, targetDir: string): Promise<number> {
  const zipFile = await openZip(filePath)
  return new Promise((resolveExtracted, rejectExtracted) => {
    let extracted = 0
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      zipFile.close()
      rejectExtracted(error)
    }

    const finish = (): void => {
      if (settled) return
      settled = true
      zipFile.close()
      resolveExtracted(extracted)
    }

    zipFile.on('entry', (entry: Entry) => {
      void extractZipEntry(zipFile, entry, targetDir)
        .then((didExtractFile) => {
          if (didExtractFile) extracted += 1
          zipFile.readEntry()
        })
        .catch(fail)
    })
    zipFile.on('end', finish)
    zipFile.on('error', fail)
    zipFile.readEntry()
  })
}

async function extractZipEntry(
  zipFile: ZipFile,
  entry: Entry,
  targetDir: string,
): Promise<boolean> {
  const outputPath = resolve(targetDir, entry.fileName)
  if (outputPath !== targetDir && !outputPath.startsWith(targetDir + sep)) {
    throw new Error(`zip 包含非法路径，已停止解压: ${entry.fileName}`)
  }

  if (entry.fileName.endsWith('/')) {
    await mkdir(outputPath, { recursive: true })
    return false
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await pipeline(await openZipEntryStream(zipFile, entry), createWriteStream(outputPath))
  return true
}

function openZipEntryStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, rejectStream) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        rejectStream(error ?? new Error(`无法读取 ${entry.fileName}`))
        return
      }
      resolveStream(stream)
    })
  })
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolveZip, rejectZip) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        rejectZip(error)
        return
      }
      if (!zipFile) {
        rejectZip(new Error('无法打开 zip 压缩包'))
        return
      }
      resolveZip(zipFile)
    })
  })
}

async function renderDocxPreview(filePath: string, fileName: string): Promise<FsRenderResult> {
  const entries = await readZipTextEntries(
    filePath,
    (entryName) => entryName === 'word/document.xml',
  )
  const documentXml = entries.get('word/document.xml')
  if (!documentXml) {
    return unsupportedOfficePreview(
      filePath,
      fileName,
      'docx 文件缺少 word/document.xml，无法生成预览。',
    )
  }

  try {
    const parsed = OOXML_PARSER.parse(documentXml)
    const body = parsed?.document?.body
    const children = objectChildren(body).filter(
      (child) => child.key === 'p' || child.key === 'tbl',
    )
    const blocks: FsOfficePreviewBlock[] = []
    let truncated = false

    for (const child of children) {
      if (blocks.length >= MAX_OFFICE_PREVIEW_BLOCKS) {
        truncated = true
        break
      }

      if (child.key === 'p') {
        const block = docxParagraphToBlock(child.value)
        if (block) blocks.push(block)
        continue
      }

      if (child.key === 'tbl') {
        const table = docxTableToBlock(child.value)
        if (table) blocks.push(table)
      }
    }

    return {
      kind: 'office-preview',
      officeKind: 'word',
      blocks,
      truncated,
      warning: '这是 docx 只读内容预览，不代表最终 S 级所见即所得保真效果。',
      fileName,
      path: filePath,
    }
  } catch (error) {
    return unsupportedOfficePreview(
      filePath,
      fileName,
      `docx XML 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function renderPptxPreview(filePath: string, fileName: string): Promise<FsRenderResult> {
  const slideEntries = await readZipTextEntries(
    filePath,
    (entryName) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName),
    MAX_PPTX_SLIDES,
  )

  if (slideEntries.size === 0) {
    return unsupportedOfficePreview(
      filePath,
      fileName,
      'pptx 文件缺少 ppt/slides/slide*.xml，无法生成预览。',
    )
  }

  const blocks: FsOfficePreviewBlock[] = []
  let truncated = false
  const sortedSlides = [...slideEntries.entries()].sort(
    ([a], [b]) => slideIndexFromEntry(a) - slideIndexFromEntry(b),
  )

  for (const [entryName, xml] of sortedSlides) {
    if (blocks.length >= MAX_OFFICE_PREVIEW_BLOCKS) {
      truncated = true
      break
    }

    try {
      const parsed = OOXML_PARSER.parse(xml)
      const lines = extractPptxTextLines(parsed).slice(0, MAX_PPTX_LINES_PER_SLIDE)
      if (lines.length === 0) continue
      const title = lines[0] ?? `幻灯片 ${slideIndexFromEntry(entryName)}`
      blocks.push({
        type: 'slide',
        index: slideIndexFromEntry(entryName),
        title,
        lines: lines.slice(1),
      })
    } catch {
      blocks.push({
        type: 'slide',
        index: slideIndexFromEntry(entryName),
        title: `幻灯片 ${slideIndexFromEntry(entryName)}`,
        lines: ['该页 XML 解析失败，已跳过内容抽取。'],
      })
    }
  }

  return {
    kind: 'office-preview',
    officeKind: 'presentation',
    blocks,
    truncated: truncated || slideEntries.size >= MAX_PPTX_SLIDES,
    warning: '这是 pptx 只读内容预览，不代表最终 S 级所见即所得保真效果。',
    fileName,
    path: filePath,
  }
}

function unsupportedOfficePreview(
  filePath: string,
  fileName: string,
  reason: string,
): FsRenderResult {
  return {
    kind: 'unsupported',
    reason,
    fileName,
    path: filePath,
  }
}

function docxParagraphToBlock(paragraph: unknown): FsOfficePreviewBlock | null {
  const text = normalizePreviewText(collectText(paragraph))
  if (!text) return null

  const paragraphRecord = firstRecord(paragraph)
  const pPr = childRecord(paragraphRecord, 'pPr')
  const pStyle = childRecord(pPr, 'pStyle')
  const style = stringValue(pStyle?.val)
  const headingMatch = /^Heading([1-6])$/i.exec(style)
  if (headingMatch) {
    return {
      type: 'heading',
      level: Number(headingMatch[1]),
      text,
    }
  }

  if (hasNode(pPr, 'numPr') || /ListParagraph/i.test(style)) {
    return {
      type: 'list-item',
      text,
    }
  }

  return {
    type: 'paragraph',
    text,
  }
}

function docxTableToBlock(table: unknown): FsOfficePreviewBlock | null {
  const tableRecord = firstRecord(table)
  const rows = asArray(tableRecord?.tr)
    .slice(0, MAX_OFFICE_TABLE_ROWS)
    .map((row) =>
      asArray(firstRecord(row)?.tc)
        .map((cell) => normalizePreviewText(collectText(cell)))
        .filter((text) => text.length > 0),
    )
    .filter((row) => row.length > 0)

  if (rows.length === 0) return null
  return { type: 'table', rows }
}

function extractPptxTextLines(parsed: unknown): string[] {
  const txBodies = collectNodesByKey(parsed, 'txBody')
  const lines: string[] = []

  for (const txBody of txBodies) {
    for (const paragraph of asArray(firstRecord(txBody)?.p)) {
      const text = normalizePreviewText(collectText(paragraph))
      if (text) lines.push(text)
    }
  }

  return lines
}

async function readZipTextEntries(
  filePath: string,
  shouldRead: (entryName: string) => boolean,
  maxEntries = Number.POSITIVE_INFINITY,
): Promise<Map<string, string>> {
  const zipFile = await openZip(filePath)
  return new Promise((resolveEntries, rejectEntries) => {
    const results = new Map<string, string>()
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      zipFile.close()
      rejectEntries(error)
    }

    const finish = (): void => {
      if (settled) return
      settled = true
      zipFile.close()
      resolveEntries(results)
    }

    zipFile.on('entry', (entry: Entry) => {
      if (!shouldRead(entry.fileName) || results.size >= maxEntries) {
        zipFile.readEntry()
        return
      }

      void openZipEntryStream(zipFile, entry)
        .then((stream) => readStreamToBuffer(stream, MAX_ZIP_TEXT_ENTRY_BYTES))
        .then((buffer) => {
          results.set(entry.fileName, buffer.toString('utf-8'))
          zipFile.readEntry()
        })
        .catch(fail)
    })
    zipFile.on('end', finish)
    zipFile.on('error', fail)
    zipFile.readEntry()
  })
}

function readStreamToBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  return new Promise((resolveBuffer, rejectBuffer) => {
    const chunks: Buffer[] = []
    let size = 0

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) {
        const destroyable = stream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }
        destroyable.destroy?.(new Error(`zip entry 超过预览大小限制: ${maxBytes} bytes`))
        return
      }
      chunks.push(buffer)
    })
    stream.on('end', () => resolveBuffer(Buffer.concat(chunks)))
    stream.on('error', rejectBuffer)
  })
}

function objectChildren(value: unknown): Array<{ key: string; value: unknown }> {
  if (!isRecord(value)) return []
  const children: Array<{ key: string; value: unknown }> = []
  for (const [key, child] of Object.entries(value)) {
    for (const item of asArray(child)) {
      children.push({ key, value: item })
    }
  }
  return children
}

function collectText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return ''
  if (Array.isArray(value)) return value.map(collectText).join('')
  if (!isRecord(value)) return ''

  const pieces: string[] = []
  if (value.t !== undefined) pieces.push(collectTextValue(value.t))
  if (value.tab !== undefined) pieces.push('\t')
  if (value.br !== undefined || value.cr !== undefined) pieces.push('\n')

  for (const [key, child] of Object.entries(value)) {
    if (key === 't' || key === 'tab' || key === 'br' || key === 'cr') continue
    pieces.push(collectText(child))
  }

  return pieces.join('')
}

function collectTextValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(collectTextValue).join('')
  if (!isRecord(value)) return ''
  const directText = value['#text']
  if (typeof directText === 'string' || typeof directText === 'number') return String(directText)
  return Object.values(value).map(collectTextValue).join('')
}

function collectNodesByKey(value: unknown, targetKey: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectNodesByKey(item, targetKey))
  if (!isRecord(value)) return []

  const nodes: unknown[] = []
  for (const [key, child] of Object.entries(value)) {
    if (key === targetKey) nodes.push(...asArray(child))
    nodes.push(...collectNodesByKey(child, targetKey))
  }
  return nodes
}

function normalizePreviewText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function slideIndexFromEntry(entryName: string): number {
  const match = /slide(\d+)\.xml$/.exec(entryName)
  return match ? Number(match[1]) : 0
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function hasNode(value: unknown, key: string): boolean {
  return isRecord(value) && value[key] !== undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const first = asArray(value)[0]
  return isRecord(first) ? first : null
}

function childRecord(
  parent: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!parent) return null
  return firstRecord(parent[key])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
