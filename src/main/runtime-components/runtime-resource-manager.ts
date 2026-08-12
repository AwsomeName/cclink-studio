import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract } from 'tar-stream'
import type {
  ManagedClaudeInstallFailure,
  ManagedClaudeInstallProgress,
  RuntimeResourceComponentId,
  RuntimeResourceOperationResult,
  RuntimeResourceStatus,
} from '../../shared/ipc/runtime-components'
import { RuntimeComponentInstallError, downloadPackage } from './runtime-component-manager'
import {
  getRuntimeResourceCatalogEntry,
  listRuntimeResourceCatalogEntries,
  type RuntimeResourceCatalogEntry,
} from './runtime-resource-catalog'

const MAX_ARCHIVE_ENTRIES = 256
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const DOWNLOAD_ATTEMPTS = 3
const MAX_REDIRECTS = 4
const DIRECT_DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com'])

interface ResourceInstallRecord {
  schemaVersion: 1
  componentId: RuntimeResourceComponentId
  version: string
  sourceKind: 'npm' | 'direct'
  installedAt: number
  files: Array<{ path: string; sha256: string; size: number }>
}

interface RuntimeResourceState {
  phase: RuntimeResourceStatus['phase']
  progress: ManagedClaudeInstallProgress | null
  failure: ManagedClaudeInstallFailure | null
  installedVersion: string | null
}

export interface ResolvedRuntimeResource {
  componentId: RuntimeResourceComponentId
  version: string
  root: string
  files: Record<string, string>
}

export interface RuntimeResourceManagerDependencies {
  now?: () => number
  downloadNpm?: typeof downloadPackage
  downloadDirect?: typeof downloadDirectResource
}

export class RuntimeResourceManager {
  private readonly root: string
  private readonly now: () => number
  private readonly downloadNpm: typeof downloadPackage
  private readonly downloadDirect: typeof downloadDirectResource
  private readonly states = new Map<RuntimeResourceComponentId, RuntimeResourceState>()
  private readonly installs = new Map<
    RuntimeResourceComponentId,
    Promise<RuntimeResourceOperationResult>
  >()

  constructor(root: string, dependencies: RuntimeResourceManagerDependencies = {}) {
    this.root = resolve(root)
    this.now = dependencies.now ?? Date.now
    this.downloadNpm = dependencies.downloadNpm ?? downloadPackage
    this.downloadDirect = dependencies.downloadDirect ?? downloadDirectResource
    for (const entry of listRuntimeResourceCatalogEntries()) {
      this.states.set(entry.componentId, emptyState())
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await Promise.all(
      listRuntimeResourceCatalogEntries().map(async (entry) => {
        await this.recoverInterruptedReplacement(entry)
        const state = this.state(entry.componentId)
        try {
          await this.verifyInstalledEntry(entry)
          state.installedVersion = entry.version
          state.phase = 'installed'
        } catch {
          state.installedVersion = null
          state.phase = 'idle'
        }
      }),
    )
  }

  listStatuses(): RuntimeResourceStatus[] {
    return listRuntimeResourceCatalogEntries().map((entry) => this.getStatus(entry.componentId))
  }

  getStatus(componentId: RuntimeResourceComponentId): RuntimeResourceStatus {
    const entry = getRuntimeResourceCatalogEntry(componentId)
    const state = this.state(componentId)
    return {
      componentId,
      displayName: entry.displayName,
      constrainedVersion: entry.version,
      availableVersion: entry.version,
      installedVersion: state.installedVersion,
      phase: state.phase,
      activation: entry.activation,
      progress: state.progress ? { ...state.progress } : null,
      failure: state.failure ? { ...state.failure } : null,
    }
  }

  install(componentId: RuntimeResourceComponentId): Promise<RuntimeResourceOperationResult> {
    if (this.installs.has(componentId)) {
      return Promise.resolve({
        success: false,
        status: this.getStatus(componentId),
        error: 'INSTALL_BUSY: 组件正在安装',
      })
    }
    const promise = this.performInstall(getRuntimeResourceCatalogEntry(componentId)).finally(() => {
      this.installs.delete(componentId)
    })
    this.installs.set(componentId, promise)
    return promise
  }

  async resolve(componentId: RuntimeResourceComponentId): Promise<ResolvedRuntimeResource | null> {
    const entry = getRuntimeResourceCatalogEntry(componentId)
    try {
      const root = await this.verifyInstalledEntry(entry)
      return {
        componentId,
        version: entry.version,
        root,
        files: Object.fromEntries(
          entry.files.map((file) => [file.installedPath, join(root, file.installedPath)]),
        ),
      }
    } catch {
      const state = this.state(componentId)
      state.installedVersion = null
      state.phase = 'idle'
      return null
    }
  }

  private async performInstall(
    entry: RuntimeResourceCatalogEntry,
  ): Promise<RuntimeResourceOperationResult> {
    const state = this.state(entry.componentId)
    state.failure = null
    state.progress = null
    try {
      await this.recoverInterruptedReplacement(entry)
      if (await this.resolve(entry.componentId)) {
        state.installedVersion = entry.version
        state.phase = 'installed'
        return { success: true, status: this.getStatus(entry.componentId) }
      }

      const componentRoot = this.componentRoot(entry)
      await mkdir(componentRoot, { recursive: true, mode: 0o700 })
      const stagingRoot = join(componentRoot, `.install-${entry.version}-${randomUUID()}`)
      await mkdir(stagingRoot, { mode: 0o700 })
      try {
        state.phase = 'downloading'
        if (entry.source.kind === 'npm') {
          const source = entry.source
          const packagePath = join(stagingRoot, 'package.tgz')
          await retryDownload(() =>
            this.downloadNpm(source.url, packagePath, source.integrity, (progress) => {
              state.progress = progress
            }),
          )
          state.phase = 'verifying'
          await extractSelectedFiles(packagePath, stagingRoot, entry)
          await rm(packagePath, { force: true })
        } else {
          const source = entry.source
          const target = join(stagingRoot, entry.files[0].installedPath)
          await retryDownload(() =>
            this.downloadDirect(source.url, target, source.size, source.sha256, (progress) => {
              state.progress = progress
            }),
          )
          state.phase = 'verifying'
          await verifyFile(target, entry.files[0])
        }

        state.phase = 'installing'
        await writeFile(
          join(stagingRoot, 'install-record.json'),
          `${JSON.stringify(createRecord(entry, this.now()), null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        )
        await this.commitStagedVersion(entry, stagingRoot)
      } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true })
        throw error
      }

      state.installedVersion = entry.version
      state.phase = 'installed'
      state.progress = null
      return { success: true, status: this.getStatus(entry.componentId) }
    } catch (error) {
      const failure = failureFrom(error)
      state.phase = 'failed'
      state.progress = null
      state.failure = failure
      return {
        success: false,
        status: this.getStatus(entry.componentId),
        error: `${failure.code}: ${failure.message}`,
      }
    }
  }

  private state(componentId: RuntimeResourceComponentId): RuntimeResourceState {
    const state = this.states.get(componentId)
    if (!state) throw new Error(`Runtime 资源状态不存在: ${componentId}`)
    return state
  }

  private componentRoot(entry: RuntimeResourceCatalogEntry): string {
    return join(this.root, entry.componentId)
  }

  private versionRoot(entry: RuntimeResourceCatalogEntry): string {
    return join(this.componentRoot(entry), entry.version)
  }

  private backupRoot(entry: RuntimeResourceCatalogEntry): string {
    return join(this.componentRoot(entry), `.backup-${entry.version}`)
  }

  private async verifyInstalledEntry(entry: RuntimeResourceCatalogEntry): Promise<string> {
    return verifyInstalledEntryAtRoot(entry, this.versionRoot(entry))
  }

  private async recoverInterruptedReplacement(entry: RuntimeResourceCatalogEntry): Promise<void> {
    const backupRoot = this.backupRoot(entry)
    if (!(await pathExists(backupRoot))) return
    try {
      await this.verifyInstalledEntry(entry)
      await rm(backupRoot, { recursive: true, force: true })
      return
    } catch {
      // Try the last verified backup below.
    }
    try {
      await verifyInstalledEntryAtRoot(entry, backupRoot)
    } catch {
      await rm(backupRoot, { recursive: true, force: true })
      return
    }
    await rm(this.versionRoot(entry), { recursive: true, force: true })
    await rename(backupRoot, this.versionRoot(entry))
  }

  private async commitStagedVersion(
    entry: RuntimeResourceCatalogEntry,
    stagingRoot: string,
  ): Promise<void> {
    const versionRoot = this.versionRoot(entry)
    const backupRoot = this.backupRoot(entry)
    await rm(backupRoot, { recursive: true, force: true })
    const hadExisting = await pathExists(versionRoot)
    try {
      if (hadExisting) await rename(versionRoot, backupRoot)
      await rename(stagingRoot, versionRoot)
      await this.verifyInstalledEntry(entry)
      await rm(backupRoot, { recursive: true, force: true })
    } catch (error) {
      await rm(versionRoot, { recursive: true, force: true })
      if (hadExisting && (await pathExists(backupRoot))) await rename(backupRoot, versionRoot)
      throw error
    }
  }
}

function emptyState(): RuntimeResourceState {
  return { phase: 'idle', progress: null, failure: null, installedVersion: null }
}

async function retryDownload(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await operation()
      return
    } catch (error) {
      const retryable =
        error instanceof RuntimeComponentInstallError && error.code === 'DOWNLOAD_FAILED'
      if (!retryable || attempt === DOWNLOAD_ATTEMPTS) throw error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 250))
    }
  }
}

async function extractSelectedFiles(
  packagePath: string,
  stagingRoot: string,
  entry: RuntimeResourceCatalogEntry,
): Promise<void> {
  const wanted = new Map(
    entry.files.map((file) => {
      if (!file.archivePath) throw new Error('npm 资源目录缺少 archivePath')
      return [file.archivePath, file]
    }),
  )
  const found = new Set<string>()
  const archive = extract()
  let entryCount = 0
  let expandedBytes = 0

  archive.on('entry', (header, stream, next) => {
    void (async () => {
      entryCount += 1
      expandedBytes += header.size ?? 0
      assertSafeArchiveEntry(header.name, header.type, entryCount, expandedBytes)
      const file = wanted.get(header.name)
      if (!file) {
        stream.resume()
        await new Promise<void>((resolveEntry, rejectEntry) => {
          stream.once('end', resolveEntry)
          stream.once('error', rejectEntry)
        })
        next()
        return
      }
      if (found.has(header.name) || header.type !== 'file') {
        throw new RuntimeComponentInstallError('PACKAGE_CONTENT_INVALID', 'npm 资源条目重复或无效')
      }
      found.add(header.name)
      const target = join(stagingRoot, file.installedPath)
      await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }))
      await verifyFile(target, file)
      next()
    })().catch((error) =>
      archive.destroy(error instanceof Error ? error : new Error(String(error))),
    )
  })

  try {
    await pipeline(createReadStream(packagePath), createGunzip(), archive)
  } catch (error) {
    if (error instanceof RuntimeComponentInstallError) throw error
    throw new RuntimeComponentInstallError(
      'PACKAGE_CONTENT_INVALID',
      `npm 资源解包失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (found.size !== wanted.size) {
    throw new RuntimeComponentInstallError('PACKAGE_CONTENT_INVALID', 'npm 包缺少允许目录中的资源')
  }
}

function assertSafeArchiveEntry(
  name: string,
  type: string | null | undefined,
  entryCount: number,
  expandedBytes: number,
): void {
  const normalized = posix.normalize(name)
  if (
    entryCount > MAX_ARCHIVE_ENTRIES ||
    expandedBytes > MAX_EXPANDED_BYTES ||
    posix.isAbsolute(name) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized !== name ||
    (type !== 'file' && type !== 'directory')
  ) {
    throw new RuntimeComponentInstallError('PACKAGE_CONTENT_INVALID', 'npm 包结构不安全')
  }
}

async function verifyInstalledEntryAtRoot(
  entry: RuntimeResourceCatalogEntry,
  root: string,
): Promise<string> {
  const record = parseRecord(JSON.parse(await readFile(join(root, 'install-record.json'), 'utf8')))
  const expected = createRecord(entry, record.installedAt)
  if (JSON.stringify(record) !== JSON.stringify(expected)) {
    throw new RuntimeComponentInstallError('INSTALL_FAILED', 'Runtime 资源安装记录与允许目录不匹配')
  }
  for (const file of entry.files) await verifyFile(join(root, file.installedPath), file)
  return root
}

async function verifyFile(path: string, file: { size: number; sha256: string }): Promise<void> {
  const fileStat = await stat(path)
  if (
    !fileStat.isFile() ||
    fileStat.size !== file.size ||
    (await sha256File(path)) !== file.sha256
  ) {
    throw new RuntimeComponentInstallError('BINARY_INTEGRITY_FAILED', 'Runtime 资源文件校验失败')
  }
}

function createRecord(
  entry: RuntimeResourceCatalogEntry,
  installedAt: number,
): ResourceInstallRecord {
  return {
    schemaVersion: 1,
    componentId: entry.componentId,
    version: entry.version,
    sourceKind: entry.source.kind,
    installedAt,
    files: entry.files.map((file) => ({
      path: file.installedPath,
      sha256: file.sha256,
      size: file.size,
    })),
  }
}

function parseRecord(value: unknown): ResourceInstallRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeComponentInstallError('INSTALL_FAILED', 'Runtime 资源安装记录无效')
  }
  const record = value as Partial<ResourceInstallRecord>
  if (
    record.schemaVersion !== 1 ||
    typeof record.componentId !== 'string' ||
    typeof record.version !== 'string' ||
    (record.sourceKind !== 'npm' && record.sourceKind !== 'direct') ||
    typeof record.installedAt !== 'number' ||
    !Array.isArray(record.files)
  ) {
    throw new RuntimeComponentInstallError('INSTALL_FAILED', 'Runtime 资源安装记录字段无效')
  }
  return record as ResourceInstallRecord
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadDirectResource(
  urlValue: string,
  destination: string,
  expectedSize: number,
  expectedSha256: string,
  onProgress: (progress: ManagedClaudeInstallProgress) => void,
): Promise<void> {
  let url = new URL(urlValue)
  let response: Response | null = null
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (url.protocol !== 'https:' || !DIRECT_DOWNLOAD_HOSTS.has(url.hostname)) {
      throw new RuntimeComponentInstallError('DOWNLOAD_FAILED', '直接下载地址不在允许列表')
    }
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'user-agent': 'CCLink-Studio-Runtime-Installer/1' },
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirect === MAX_REDIRECTS) {
      throw new RuntimeComponentInstallError('DOWNLOAD_FAILED', '直接下载重定向无效')
    }
    url = new URL(location, url)
  }
  if (!response?.ok || !response.body) {
    throw new RuntimeComponentInstallError(
      'DOWNLOAD_FAILED',
      `Runtime 资源下载失败：HTTP ${response?.status ?? 'unknown'}`,
    )
  }

  const hash = createHash('sha256')
  let receivedBytes = 0
  const tracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > expectedSize) {
        callback(new RuntimeComponentInstallError('DOWNLOAD_TOO_LARGE', 'Runtime 资源超过允许大小'))
        return
      }
      hash.update(chunk)
      onProgress({
        receivedBytes,
        totalBytes: expectedSize,
        percent: Math.min(100, Math.round((receivedBytes / expectedSize) * 100)),
      })
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      tracker,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    )
  } catch (error) {
    await rm(destination, { force: true })
    if (error instanceof RuntimeComponentInstallError) throw error
    throw new RuntimeComponentInstallError(
      'DOWNLOAD_FAILED',
      `Runtime 资源下载失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (receivedBytes !== expectedSize || hash.digest('hex') !== expectedSha256) {
    await rm(destination, { force: true })
    throw new RuntimeComponentInstallError(
      'BINARY_INTEGRITY_FAILED',
      'Runtime 资源 SHA-256 校验失败',
    )
  }
}

function failureFrom(error: unknown): ManagedClaudeInstallFailure {
  if (error instanceof RuntimeComponentInstallError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'INSTALL_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}
