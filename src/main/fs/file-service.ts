import { readdir, readFile, writeFile, stat, mkdir, rename, unlink } from 'fs/promises'
import { createWriteStream, watch } from 'fs'
import { join, resolve, extname, dirname, parse, sep, basename, relative } from 'path'
import { pipeline } from 'stream/promises'
import { app, shell } from 'electron'
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
  FsExtractZipResult,
  FsOfficePreviewBlock,
  FsRenderResult,
  FsSaveTextDocumentResult,
  FsTextDocumentSnapshot,
} from '../../shared/ipc/fs'
import { isMarkdownDocumentPath } from '../../shared/markdown-document'
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

/**
 * 文件系统操作服务
 * 提供安全的文件读写能力，限制在工作区目录内
 */
export class FileService {
  /** 允许访问的根目录列表（用户主目录 + Desktop + Documents + Downloads） */
  private allowedRoots: string[]
  private markdownDocuments: MarkdownDocumentService

  constructor() {
    const home = app.getPath('home')
    this.allowedRoots = [
      home,
      app.getPath('desktop'),
      app.getPath('documents'),
      app.getPath('downloads'),
    ]
    this.markdownDocuments = new MarkdownDocumentService((filePath) => this.validatePath(filePath))
  }

  /**
   * 安全校验：确保目标路径在允许的根目录下
   * 防止目录穿越攻击（如 ../../etc/passwd）和路径前缀攻击（如 /Users/testuser）
   */
  private validatePath(targetPath: string): string {
    const resolved = resolve(targetPath)
    const isAllowed = this.allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + sep),
    )
    if (!isAllowed) {
      throw new Error(`路径不在允许范围内: ${resolved}`)
    }
    return resolved
  }

  /** 读取目录内容（options.showHiddenFiles 为真时不过滤 . 开头的隐藏文件） */
  async readDir(dirPath: string, options?: { showHiddenFiles?: boolean }): Promise<DirEntry[]> {
    const safe = this.validatePath(dirPath)
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

  /** 读取文件内容 */
  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    const safe = this.validatePath(filePath)
    const buffer = await readFile(safe)
    const ext = extname(safe).toLowerCase()

    // 二进制文件返回 base64，避免编辑器把模型/压缩包当 UTF-8 文本解析。
    if (isBinaryFileExtension(ext)) {
      return { content: buffer.toString('base64'), encoding: 'base64' }
    }

    return { content: buffer.toString('utf-8'), encoding: 'utf-8' }
  }

  async readTextDocument(filePath: string): Promise<FsTextDocumentSnapshot> {
    const safe = this.validatePath(filePath)
    const [buffer, fileStat] = await Promise.all([readFile(safe), stat(safe)])
    return textDocumentSnapshot(safe, buffer, fileStat.mtimeMs)
  }

  /** 渲染只读文件预览。渲染进程只消费结构化结果，不直接读取本机文件。 */
  async renderFile(filePath: string): Promise<FsRenderResult> {
    const safe = this.validatePath(filePath)
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
    const safe = this.validatePath(filePath)
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
    // 写入前确保目录存在
    const safe = this.validatePath(filePath)
    await mkdir(dirname(safe), { recursive: true })
    await writeFile(safe, content, 'utf-8')
  }

  async saveTextDocument(input: {
    filePath: string
    content: string
    expectedHash?: string
    force?: boolean
  }): Promise<FsSaveTextDocumentResult> {
    const safe = this.validatePath(input.filePath)
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
    const safeDocument = this.validatePath(documentPath)
    const safeSource = this.validatePath(sourcePath)
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
    const safeDocument = this.validatePath(input.documentPath)
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

  async inspectMarkdownDocument(documentPath: string) {
    const safe = this.validatePath(documentPath)
    if (!isMarkdownDocumentPath(safe)) throw new Error('仅支持检查 Markdown 文档')
    return this.markdownDocuments.inspect(safe)
  }

  async saveMarkdownDocumentAs(input: {
    sourcePath?: string
    targetPath: string
    content: string
  }) {
    const sourcePath = input.sourcePath ? this.validatePath(input.sourcePath) : undefined
    const targetPath = this.validatePath(input.targetPath)
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
    const sourcePath = this.validatePath(input.sourcePath)
    const targetPath = this.validatePath(input.targetPath)
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
    const documentPath = this.validatePath(input.documentPath)
    const targetPath = this.validatePath(input.targetPath)
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

  async trashMarkdownDocument(input: { documentPath: string; includeAssets: boolean }) {
    const documentPath = this.validatePath(input.documentPath)
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

  /** 获取文件/目录元数据 */
  async stat(filePath: string): Promise<FileStat> {
    const safe = this.validatePath(filePath)
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
      const safe = this.validatePath(dirPath)
      const s = await stat(safe)
      return s.isDirectory()
    } catch {
      return false
    }
  }

  /** 创建目录 */
  async mkdir(dirPath: string): Promise<void> {
    const safe = this.validatePath(dirPath)
    await mkdir(safe, { recursive: true })
  }

  /** 重命名/移动文件 */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const safeOld = this.validatePath(oldPath)
    const safeNew = this.validatePath(newPath)
    await rename(safeOld, safeNew)
  }

  /** 移动文件/目录，不允许覆盖目标中的同名项。 */
  async move(oldPath: string, newPath: string): Promise<void> {
    const safeOld = this.validatePath(oldPath)
    const safeNew = this.validatePath(newPath)
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

  /** 删除文件 */
  async delete(filePath: string): Promise<void> {
    const safe = this.validatePath(filePath)
    await unlink(safe)
  }

  /** 监听目录变更 */
  watchDir(
    dirPath: string,
    onChange: (event: 'add' | 'change' | 'unlink', filePath: string) => void,
  ): { stop: () => void } {
    const safe = this.validatePath(dirPath)
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
