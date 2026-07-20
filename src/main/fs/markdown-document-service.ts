import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, parse, relative, resolve, sep } from 'node:path'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import {
  collectMarkdownDestinations,
  isExternalMarkdownDestination,
  markdownAssetDirectoryName,
  markdownDocumentBaseName,
  markdownResourceManifestReference,
  parseCclinkMarkdownMetadata,
  rewriteMarkdownDestinations,
  splitMarkdownDestinationSuffix,
  stripCclinkMarkdownMetadata,
  withCclinkMarkdownMetadata,
} from '../../shared/markdown-document'
import type {
  FsDocumentAssetResult,
  FsMarkdownAssetManifestEntry,
  FsMarkdownDocumentInspection,
  FsMarkdownExportResult,
  FsMarkdownRelocateResult,
  FsMarkdownSaveAsResult,
  FsTextDocumentSnapshot,
} from '../../shared/ipc/fs'

const MANIFEST_FILE_NAME = 'manifest.json'
const MANIFEST_FORMAT = 'cclink-markdown-resources'

interface MarkdownAssetManifest {
  format: typeof MANIFEST_FORMAT
  version: 1
  document: string
  updatedAt: string
  assets: FsMarkdownAssetManifestEntry[]
}

interface PreparedMarkdownSave {
  content: string
  assetDir: string
  legacyAssetDir: string
  migratedLegacyAssets: boolean
  assetCount: number
}

export class MarkdownDocumentService {
  constructor(
    private validateReferencePath: (filePath: string) => string = (filePath) => filePath,
  ) {}

  async importAsset(documentPath: string, sourcePath: string): Promise<FsDocumentAssetResult> {
    const target = await this.createAssetPath(documentPath, basename(sourcePath))
    await copyFile(sourcePath, target.path)
    await this.writeManifest(documentPath)
    return target
  }

  async saveAsset(
    documentPath: string,
    requestedName: string,
    content: Buffer,
  ): Promise<FsDocumentAssetResult> {
    const target = await this.createAssetPath(documentPath, requestedName)
    await writeFile(target.path, content)
    await this.writeManifest(documentPath)
    return target
  }

  async prepareSave(documentPath: string, source: string): Promise<PreparedMarkdownSave> {
    const assetDir = markdownAssetDirectoryPath(documentPath)
    const legacyAssetDir = legacyMarkdownAssetDirectoryPath(documentPath)
    const metadata = parseCclinkMarkdownMetadata(source)
    const legacyRewrites = (await isDirectory(legacyAssetDir))
      ? await mergeLegacyAssets(legacyAssetDir, assetDir)
      : null
    const migratedLegacyAssets = legacyRewrites !== null

    const assets = await this.writeManifest(documentPath)
    let content = stripCclinkMarkdownMetadata(source)
    if (legacyRewrites) {
      content = rewriteLegacyAssetReferences(content, documentPath, legacyRewrites)
    }
    const shouldDeclareResources =
      assets.length > 0 || metadata !== null || referencesManagedAssets(content, documentPath)
    content = shouldDeclareResources ? withCclinkMarkdownMetadata(content, documentPath) : content

    return {
      content,
      assetDir,
      legacyAssetDir,
      migratedLegacyAssets,
      assetCount: assets.length,
    }
  }

  async finalizeSave(prepared: PreparedMarkdownSave): Promise<void> {
    if (!prepared.migratedLegacyAssets) return
    await rm(prepared.legacyAssetDir, { recursive: true, force: true })
    const hiddenRoot = dirname(prepared.legacyAssetDir)
    const remaining = await readdir(hiddenRoot).catch(() => ['not-empty'])
    if (remaining.length === 0) await rm(hiddenRoot, { recursive: true, force: true })
  }

  async inspect(documentPath: string): Promise<FsMarkdownDocumentInspection> {
    const source = await readFile(documentPath, 'utf-8')
    const assetDir = markdownAssetDirectoryPath(documentPath)
    const manifestPath = join(assetDir, MANIFEST_FILE_NAME)
    const legacyAssetDir = legacyMarkdownAssetDirectoryPath(documentPath)
    const assetDirectoryPresent = await isDirectory(assetDir)
    const legacyPresent = await isDirectory(legacyAssetDir)
    const metadata = parseCclinkMarkdownMetadata(source)
    const manifest = assetDirectoryPresent ? await readManifest(manifestPath) : null
    const manifestStatus: FsMarkdownDocumentInspection['manifestStatus'] = !assetDirectoryPresent
      ? 'missing'
      : manifest
        ? 'current'
        : (await pathExists(manifestPath))
          ? 'invalid'
          : 'missing'

    const references = collectMarkdownDestinations(source)
      .map((destination) => destination.value)
      .filter((destination) => !isExternalMarkdownDestination(destination))
    const missingAssets: string[] = []
    const unmanagedLocalAssets: string[] = []
    const referencedManagedFiles = new Set<string>()
    for (const reference of references) {
      const absolute = resolveMarkdownReference(documentPath, reference)
      if (!absolute) continue
      try {
        this.validateReferencePath(absolute)
      } catch {
        missingAssets.push(reference)
        continue
      }
      if (!(await pathExists(absolute))) missingAssets.push(reference)
      if (isPathWithin(assetDir, absolute)) {
        referencedManagedFiles.add(normalizeRelativePath(relative(assetDir, absolute)))
      } else if (!isPathWithin(legacyAssetDir, absolute) && (await pathExists(absolute))) {
        unmanagedLocalAssets.push(reference)
      }
    }

    const actualAssets = assetDirectoryPresent ? await listAssetEntries(assetDir) : []
    const orphanAssets = actualAssets
      .map((entry) => entry.relativePath)
      .filter((filePath) => !referencedManagedFiles.has(filePath))
    const modifiedAssets: string[] = []
    if (manifest) {
      const actualByPath = new Map(actualAssets.map((entry) => [entry.relativePath, entry]))
      for (const entry of manifest.assets) {
        const actual = actualByPath.get(entry.path)
        if (!actual) continue
        if (
          actual.size !== entry.size ||
          (await sha256File(actual.absolutePath)) !== entry.sha256
        ) {
          modifiedAssets.push(entry.path)
        }
      }
    }

    const warnings: string[] = []
    if (metadata && !assetDirectoryPresent)
      warnings.push(`声明的资源目录不存在: ${metadata.metadata.resources}`)
    if (
      metadata &&
      metadata.metadata.resources !== markdownResourceManifestReference(documentPath)
    ) {
      warnings.push('资源声明与当前 Markdown 文件名不一致，将在下次保存时修正')
    }
    if (assetDirectoryPresent && manifestStatus === 'missing')
      warnings.push('资源清单缺失，可在下次保存时重建')
    if (manifestStatus === 'invalid') warnings.push('资源清单无效，可在下次保存时重建')
    if (legacyPresent) warnings.push('检测到旧版隐藏资源目录，将在下次保存时迁移')
    if (missingAssets.length > 0) warnings.push(`缺少 ${missingAssets.length} 个本地资源`)
    if (unmanagedLocalAssets.length > 0) {
      warnings.push(`${unmanagedLocalAssets.length} 个本地引用不在受管资源目录中`)
    }
    if (modifiedAssets.length > 0) warnings.push(`${modifiedAssets.length} 个资源已被外部修改`)
    if (orphanAssets.length > 0) warnings.push(`${orphanAssets.length} 个资源未被正文引用`)

    return {
      documentPath,
      assetDir,
      manifestPath,
      declarationPresent: metadata !== null,
      assetDirectoryPresent,
      manifestStatus,
      ...(legacyPresent ? { legacyAssetDir } : {}),
      referencedAssets: Array.from(referencedManagedFiles).sort(),
      unmanagedLocalAssets: uniqueSorted(unmanagedLocalAssets),
      missingAssets: uniqueSorted(missingAssets),
      modifiedAssets: uniqueSorted(modifiedAssets),
      orphanAssets: uniqueSorted(orphanAssets),
      warnings,
    }
  }

  async saveAs(input: {
    sourcePath?: string
    targetPath: string
    content: string
    save: (filePath: string, content: string) => Promise<FsTextDocumentSnapshot>
  }): Promise<FsMarkdownSaveAsResult> {
    const { sourcePath, targetPath } = input
    if (sourcePath && sourcePath === targetPath) {
      return {
        filePath: targetPath,
        copiedAssets: 0,
        snapshot: await input.save(targetPath, input.content),
      }
    }

    const targetAssetDir = markdownAssetDirectoryPath(targetPath)
    if (await pathExists(targetAssetDir)) throw new Error('EEXIST: 目标资源目录已存在')
    const sourcePrepared = sourcePath ? await this.prepareSave(sourcePath, input.content) : null
    const sourceAssetDir = sourcePrepared?.assetCount ? sourcePrepared.assetDir : null
    let copiedAssets = 0
    let createdTargetAssets = false
    try {
      if (sourceAssetDir) {
        await copyAssetDirectory(sourceAssetDir, targetAssetDir)
        createdTargetAssets = true
        copiedAssets = (await listAssetEntries(targetAssetDir)).length
      }

      const sourceContent = sourcePrepared?.content ?? input.content
      const metadata = parseCclinkMarkdownMetadata(sourceContent)
      let content = stripCclinkMarkdownMetadata(sourceContent)
      if (sourcePath && sourceAssetDir) {
        content = rewriteDocumentReferences(
          content,
          sourcePath,
          targetPath,
          sourceAssetDir,
          targetAssetDir,
        )
      }
      if (copiedAssets > 0 || metadata) content = withCclinkMarkdownMetadata(content, targetPath)
      const snapshot = await input.save(targetPath, content)
      return {
        filePath: targetPath,
        ...(copiedAssets > 0 ? { assetDir: targetAssetDir } : {}),
        copiedAssets,
        snapshot,
      }
    } catch (error) {
      if (createdTargetAssets) await rm(targetAssetDir, { recursive: true, force: true })
      throw error
    }
  }

  async relocate(input: {
    sourcePath: string
    targetPath: string
    save: (filePath: string, content: string) => Promise<FsTextDocumentSnapshot>
  }): Promise<FsMarkdownRelocateResult> {
    const { sourcePath, targetPath } = input
    if (sourcePath === targetPath) {
      return {
        oldPath: sourcePath,
        newPath: targetPath,
        snapshot: textSnapshot(
          sourcePath,
          await readFile(sourcePath),
          (await stat(sourcePath)).mtimeMs,
        ),
      }
    }
    if (await pathExists(targetPath)) throw new Error('EEXIST: 目标文件已存在')

    const targetAssetDir = markdownAssetDirectoryPath(targetPath)
    if (await pathExists(targetAssetDir)) {
      throw new Error('EEXIST: 目标资源目录已存在')
    }

    const sourceContent = await readFile(sourcePath, 'utf-8')
    const sourcePrepared = await this.prepareSave(sourcePath, sourceContent)
    const sourceAssetDir = sourcePrepared.assetCount > 0 ? sourcePrepared.assetDir : null
    const metadata = parseCclinkMarkdownMetadata(sourcePrepared.content)
    let content = stripCclinkMarkdownMetadata(sourcePrepared.content)
    content = rewriteDocumentReferences(
      content,
      sourcePath,
      targetPath,
      sourceAssetDir,
      targetAssetDir,
    )
    if (sourceAssetDir || metadata) content = withCclinkMarkdownMetadata(content, targetPath)

    let movedAssets = false
    let movedDocument = false
    try {
      await mkdir(dirname(targetPath), { recursive: true })
      if (sourceAssetDir) {
        await rename(sourceAssetDir, targetAssetDir)
        movedAssets = true
      }
      await rename(sourcePath, targetPath)
      movedDocument = true
      const snapshot = await input.save(targetPath, content)
      await this.finalizeSave(sourcePrepared)
      return {
        oldPath: sourcePath,
        newPath: targetPath,
        ...(sourceAssetDir ? { oldAssetDir: sourceAssetDir, newAssetDir: targetAssetDir } : {}),
        snapshot,
      }
    } catch (error) {
      if (movedDocument && !(await pathExists(sourcePath))) {
        await rename(targetPath, sourcePath).catch(() => {})
      }
      if (movedAssets && sourceAssetDir && !(await pathExists(sourceAssetDir))) {
        await mkdir(dirname(sourceAssetDir), { recursive: true }).catch(() => {})
        await rename(targetAssetDir, sourceAssetDir).catch(() => {})
      }
      throw error
    }
  }

  async exportZip(documentPath: string, targetPath: string): Promise<FsMarkdownExportResult> {
    const rawContent = await readFile(documentPath, 'utf-8')
    const prepared = await this.prepareSave(documentPath, rawContent)
    if (prepared.assetCount > 0) await this.writeManifest(documentPath)
    const inspection = await this.inspectPrepared(documentPath, prepared.content)
    if (inspection.missingAssets.length > 0) {
      throw new Error(`无法导出: 缺少 ${inspection.missingAssets.length} 个本地资源`)
    }
    if (inspection.unmanagedLocalAssets.length > 0) {
      throw new Error(
        `无法导出: ${inspection.unmanagedLocalAssets.length} 个本地引用不在 ${markdownAssetDirectoryName(documentPath)} 中`,
      )
    }

    const rootName = sanitizeZipSegment(markdownDocumentBaseName(documentPath))
    const entries: ZipSourceEntry[] = [
      {
        archivePath: `${rootName}/${basename(documentPath)}`,
        content: Buffer.from(prepared.content, 'utf-8'),
      },
    ]
    if (prepared.assetCount > 0) {
      for (const asset of await listAssetEntries(prepared.assetDir, true)) {
        entries.push({
          archivePath: `${rootName}/${markdownAssetDirectoryName(documentPath)}/${asset.relativePath}`,
          filePath: asset.absolutePath,
        })
      }
    }
    await writeZipArchive(targetPath, entries)
    return { zipPath: targetPath, entries: entries.length }
  }

  async existingResourceDirectories(documentPath: string): Promise<string[]> {
    const candidates = [
      markdownAssetDirectoryPath(documentPath),
      legacyMarkdownAssetDirectoryPath(documentPath),
    ]
    const result: string[] = []
    for (const candidate of candidates) {
      if (await isDirectory(candidate)) result.push(candidate)
    }
    return result
  }

  private async inspectPrepared(
    documentPath: string,
    content: string,
  ): Promise<Pick<FsMarkdownDocumentInspection, 'missingAssets' | 'unmanagedLocalAssets'>> {
    const missingAssets: string[] = []
    const unmanagedLocalAssets: string[] = []
    const assetDir = markdownAssetDirectoryPath(documentPath)
    for (const destination of collectMarkdownDestinations(content)) {
      if (isExternalMarkdownDestination(destination.value)) continue
      const absolute = resolveMarkdownReference(documentPath, destination.value)
      if (!absolute) continue
      try {
        this.validateReferencePath(absolute)
      } catch {
        missingAssets.push(destination.value)
        continue
      }
      if (!(await pathExists(absolute))) missingAssets.push(destination.value)
      else if (!isPathWithin(assetDir, absolute)) unmanagedLocalAssets.push(destination.value)
    }
    return {
      missingAssets: uniqueSorted(missingAssets),
      unmanagedLocalAssets: uniqueSorted(unmanagedLocalAssets),
    }
  }

  private async createAssetPath(
    documentPath: string,
    requestedName: string,
  ): Promise<FsDocumentAssetResult> {
    const assetDir = markdownAssetDirectoryPath(documentPath)
    await mkdir(assetDir, { recursive: true })
    const fileName = await uniqueFileName(assetDir, basename(requestedName))
    const targetPath = join(assetDir, fileName)
    return {
      path: targetPath,
      relativePath: normalizeRelativePath(relative(dirname(documentPath), targetPath)),
      fileName,
    }
  }

  private async writeManifest(documentPath: string): Promise<FsMarkdownAssetManifestEntry[]> {
    const assetDir = markdownAssetDirectoryPath(documentPath)
    if (!(await isDirectory(assetDir))) return []
    const files = await listAssetEntries(assetDir)
    const assets: FsMarkdownAssetManifestEntry[] = []
    for (const file of files) {
      assets.push({
        path: file.relativePath,
        mediaType: mediaTypeForPath(file.relativePath),
        size: file.size,
        sha256: await sha256File(file.absolutePath),
      })
    }
    if (assets.length === 0) {
      await unlink(join(assetDir, MANIFEST_FILE_NAME)).catch(() => {})
      return []
    }
    const manifest: MarkdownAssetManifest = {
      format: MANIFEST_FORMAT,
      version: 1,
      document: `../${basename(documentPath)}`,
      updatedAt: new Date().toISOString(),
      assets,
    }
    await atomicWriteFile(
      join(assetDir, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    return assets
  }
}

function markdownAssetDirectoryPath(documentPath: string): string {
  return join(dirname(documentPath), markdownAssetDirectoryName(documentPath))
}

function legacyMarkdownAssetDirectoryPath(documentPath: string): string {
  return join(dirname(documentPath), '.assets', markdownDocumentBaseName(documentPath))
}

function rewriteLegacyAssetReferences(
  source: string,
  documentPath: string,
  rewrites: Map<string, string>,
): string {
  const oldDirectory = `.assets/${markdownDocumentBaseName(documentPath)}`
  const newDirectory = markdownAssetDirectoryName(documentPath)
  return rewriteMarkdownDestinations(source, (destination) => {
    const { path, suffix } = splitMarkdownDestinationSuffix(destination)
    const normalized = decodeMarkdownPath(path).replace(/^\.\//, '').replace(/\\/g, '/')
    if (normalized !== oldDirectory && !normalized.startsWith(`${oldDirectory}/`))
      return destination
    const oldRelativePath = normalized.slice(oldDirectory.length).replace(/^\//, '')
    const nextRelativePath = rewrites.get(oldRelativePath) ?? oldRelativePath
    const next = `${newDirectory}/${nextRelativePath}`
    return `${encodeMarkdownPath(next)}${suffix}`
  })
}

function referencesManagedAssets(source: string, documentPath: string): boolean {
  const visibleDirectory = markdownAssetDirectoryName(documentPath)
  const legacyDirectory = `.assets/${markdownDocumentBaseName(documentPath)}`
  return collectMarkdownDestinations(source).some((destination) => {
    if (isExternalMarkdownDestination(destination.value)) return false
    const { path } = splitMarkdownDestinationSuffix(destination.value)
    const normalized = decodeMarkdownPath(path).replace(/^\.\//, '').replace(/\\/g, '/')
    return (
      normalized === visibleDirectory ||
      normalized.startsWith(`${visibleDirectory}/`) ||
      normalized === legacyDirectory ||
      normalized.startsWith(`${legacyDirectory}/`)
    )
  })
}

function rewriteDocumentReferences(
  source: string,
  sourcePath: string,
  targetPath: string,
  sourceAssetDir: string | null,
  targetAssetDir: string,
): string {
  return rewriteMarkdownDestinations(source, (destination) => {
    if (isExternalMarkdownDestination(destination)) return destination
    const { path, suffix } = splitMarkdownDestinationSuffix(destination)
    if (!path || path.startsWith('/')) return destination
    const decoded = decodeMarkdownPath(path)
    const absoluteSource = resolve(dirname(sourcePath), decoded)
    const absoluteTarget =
      sourceAssetDir && isPathWithin(sourceAssetDir, absoluteSource)
        ? join(targetAssetDir, relative(sourceAssetDir, absoluteSource))
        : absoluteSource
    const next =
      normalizeRelativePath(relative(dirname(targetPath), absoluteTarget)) ||
      basename(absoluteTarget)
    return `${encodeMarkdownPath(next)}${suffix}`
  })
}

function resolveMarkdownReference(documentPath: string, destination: string): string | null {
  if (isExternalMarkdownDestination(destination)) return null
  const { path } = splitMarkdownDestinationSuffix(destination)
  if (!path) return null
  return resolve(dirname(documentPath), decodeMarkdownPath(path))
}

async function copyAssetDirectory(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (sourcePath) => basename(sourcePath) !== MANIFEST_FILE_NAME,
  })
}

async function mergeLegacyAssets(source: string, target: string): Promise<Map<string, string>> {
  const rewrites = new Map<string, string>()
  await mkdir(target, { recursive: true })
  for (const file of await listAssetEntries(source)) {
    let targetPath = join(target, file.relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    if (await pathExists(targetPath)) {
      const [sourceHash, targetHash] = await Promise.all([
        sha256File(file.absolutePath),
        sha256File(targetPath),
      ])
      if (sourceHash !== targetHash) {
        const fileName = await uniqueFileName(dirname(targetPath), basename(targetPath))
        targetPath = join(dirname(targetPath), fileName)
      }
    }
    if (!(await pathExists(targetPath))) await copyFile(file.absolutePath, targetPath)
    rewrites.set(file.relativePath, normalizeRelativePath(relative(target, targetPath)))
  }
  return rewrites
}

interface AssetFileEntry {
  absolutePath: string
  relativePath: string
  size: number
}

async function listAssetEntries(
  assetDir: string,
  includeManifest = false,
): Promise<AssetFileEntry[]> {
  const result: AssetFileEntry[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`资源目录不允许符号链接: ${entry.name}`)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile() || (!includeManifest && entry.name === MANIFEST_FILE_NAME)) continue
      const fileStat = await stat(absolutePath)
      result.push({
        absolutePath,
        relativePath: normalizeRelativePath(relative(assetDir, absolutePath)),
        size: fileStat.size,
      })
    }
  }
  await visit(assetDir)
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function readManifest(filePath: string): Promise<MarkdownAssetManifest | null> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf-8')) as Partial<MarkdownAssetManifest>
    if (
      value.format !== MANIFEST_FORMAT ||
      value.version !== 1 ||
      typeof value.document !== 'string' ||
      !Array.isArray(value.assets)
    ) {
      return null
    }
    return value as MarkdownAssetManifest
  } catch {
    return null
  }
}

async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, content)
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk as Buffer))
    input.once('end', resolvePromise)
    input.once('error', rejectPromise)
  })
  return hash.digest('hex')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function uniqueFileName(directory: string, requested: string): Promise<string> {
  const parsed = parse(requested)
  const base = parsed.name || 'asset'
  const extension = parsed.ext
  let candidate = `${base}${extension}`
  let index = 1
  while (await pathExists(join(directory, candidate))) {
    candidate = `${base}-${index}${extension}`
    index += 1
  }
  return candidate
}

function isPathWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep)
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function decodeMarkdownPath(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function encodeMarkdownPath(value: string): string {
  return encodeURI(normalizeRelativePath(value)).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function mediaTypeForPath(filePath: string): string | null {
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  }
  return types[extname(filePath).toLowerCase()] ?? null
}

function textSnapshot(
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

interface ZipSourceEntry {
  archivePath: string
  filePath?: string
  content?: Buffer
}

async function writeZipArchive(targetPath: string, entries: ZipSourceEntry[]): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`)
  const output = createWriteStream(tempPath, { flags: 'wx' })
  let settled = false
  const completion = new Promise<void>((resolvePromise, rejectPromise) => {
    output.once('finish', () => {
      settled = true
      resolvePromise()
    })
    output.once('error', (error) => {
      settled = true
      rejectPromise(error)
    })
  })
  const zip = new Zip((error, data, final) => {
    if (error) {
      output.destroy(error)
      return
    }
    output.write(Buffer.from(data))
    if (final) output.end()
  })

  try {
    for (const entry of entries) {
      const archivePath = normalizeZipPath(entry.archivePath)
      const compressed = shouldStoreZipEntry(archivePath)
        ? new ZipPassThrough(archivePath)
        : new ZipDeflate(archivePath, { level: 6 })
      zip.add(compressed)
      if (entry.content) {
        compressed.push(entry.content, true)
        continue
      }
      if (!entry.filePath) throw new Error(`ZIP 条目缺少来源: ${archivePath}`)
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const input = createReadStream(entry.filePath!)
        input.on('data', (chunk) => compressed.push(Buffer.from(chunk as Buffer), false))
        input.once('end', () => {
          compressed.push(new Uint8Array(0), true)
          resolvePromise()
        })
        input.once('error', rejectPromise)
      })
    }
    zip.end()
    await completion
    await rename(tempPath, targetPath)
  } catch (error) {
    if (!settled) output.destroy()
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

function normalizeZipPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`非法 ZIP 条目路径: ${value}`)
  }
  return normalized
}

function sanitizeZipSegment(value: string): string {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, '-').trim()
  return sanitized || 'document'
}

function shouldStoreZipEntry(filePath: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|zip|pdf|mp4|mov|webm|mp3|m4a|aac|flac|ogg|opus)$/i.test(filePath)
}
