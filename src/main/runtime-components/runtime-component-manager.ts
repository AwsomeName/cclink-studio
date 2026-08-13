import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'
import { extract } from 'tar-stream'
import type {
  ManagedClaudeInstallErrorCode,
  ManagedClaudeInstallFailure,
  ManagedClaudeInstallProgress,
  ManagedClaudeRuntimeOperationResult,
  ManagedClaudeRuntimeStatus,
  RuntimeResourceComponentId,
  RuntimeResourceOperationResult,
  RuntimeResourceStatus,
} from '../../shared/ipc/runtime-components'
import {
  getManagedClaudeRuntimeCatalogEntry,
  type ManagedClaudeRuntimeCatalogEntry,
} from './claude-runtime-catalog'
import {
  RuntimeResourceManager,
  type ResolvedRuntimeResource,
  type ResolvedRuntimeResourceLease,
} from './runtime-resource-manager'

const execFileAsync = promisify(execFile)
const INSTALL_RECORD_SCHEMA_VERSION = 1
const MAX_DOWNLOAD_BYTES = 160 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 64
const MAX_EXPANDED_BYTES = 300 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const DOWNLOAD_ATTEMPTS = 3
const PROBE_TIMEOUT_MS = 15_000
const ALLOWED_DOWNLOAD_HOSTS = new Set(['registry.npmjs.org'])

interface ManagedClaudeInstallRecord {
  schemaVersion: 1
  componentId: 'claude-runtime'
  runtimeVersion: string
  sdkVersion: string
  platform: 'darwin'
  arch: 'arm64' | 'x64'
  packageName: string
  packageVersion: string
  tarballIntegrity: string
  binarySha256: string
  binarySize: number
  executable: 'claude'
  installedAt: number
}

export interface ResolvedManagedClaudeRuntime {
  executablePath: string
  runtimeVersion: string
  sdkVersion: string
  sha256: string
  platform: 'darwin'
  arch: 'arm64' | 'x64'
}

export interface RuntimeComponentManagerDependencies {
  platform?: NodeJS.Platform
  arch?: string
  now?: () => number
  download?: typeof downloadPackage
  verifyCodeSignature?: (path: string) => Promise<void>
  executeVersion?: (path: string) => Promise<string>
  resolveCatalogEntry?: (
    platform: NodeJS.Platform,
    arch: string,
  ) => ManagedClaudeRuntimeCatalogEntry | null
}

export class RuntimeComponentInstallError extends Error {
  readonly code: ManagedClaudeInstallErrorCode

  constructor(code: ManagedClaudeInstallErrorCode, message: string) {
    super(message)
    this.name = 'RuntimeComponentInstallError'
    this.code = code
  }
}

export class RuntimeComponentManager {
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly now: () => number
  private readonly download: typeof downloadPackage
  private readonly verifyCodeSignature: (path: string) => Promise<void>
  private readonly executeVersion: (path: string) => Promise<string>
  private readonly resolveCatalogEntry: RuntimeComponentManagerDependencies['resolveCatalogEntry']
  private readonly root: string
  private readonly resourceManager: RuntimeResourceManager
  private phase: ManagedClaudeRuntimeStatus['phase'] = 'idle'
  private progress: ManagedClaudeInstallProgress | null = null
  private failure: ManagedClaudeInstallFailure | null = null
  private installedVersions: string[] = []
  private health: ManagedClaudeRuntimeStatus['health'] = 'not-installed'
  private operationPromise: Promise<ManagedClaudeRuntimeOperationResult> | null = null

  constructor(root: string, dependencies: RuntimeComponentManagerDependencies = {}) {
    this.root = resolve(root)
    this.resourceManager = new RuntimeResourceManager(this.root, { now: dependencies.now })
    this.platform = dependencies.platform ?? process.platform
    this.arch = dependencies.arch ?? process.arch
    this.now = dependencies.now ?? Date.now
    this.download = dependencies.download ?? downloadPackage
    this.verifyCodeSignature = dependencies.verifyCodeSignature ?? verifyMacCodeSignature
    this.executeVersion = dependencies.executeVersion ?? executeClaudeVersion
    this.resolveCatalogEntry =
      dependencies.resolveCatalogEntry ?? getManagedClaudeRuntimeCatalogEntry
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await this.resourceManager.initialize()
    const entry = this.catalogEntry()
    if (!entry) {
      this.installedVersions = []
      return
    }
    await mkdir(this.configRoot(entry), { recursive: true, mode: 0o700 })
    await this.recoverInterruptedReplacement(entry)
    await this.refreshManagedClaudeStatus(entry, false)
  }

  listRuntimeResources(): RuntimeResourceStatus[] {
    return this.resourceManager.listStatuses()
  }

  installRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult> {
    return this.resourceManager.install(componentId)
  }

  checkRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult> {
    return this.resourceManager.check(componentId)
  }

  repairRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult> {
    return this.resourceManager.repair(componentId)
  }

  uninstallRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult> {
    return this.resourceManager.uninstall(componentId)
  }

  resolveRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<ResolvedRuntimeResource | null> {
    return this.resourceManager.resolve(componentId)
  }

  acquireRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<ResolvedRuntimeResourceLease | null> {
    return this.resourceManager.acquire(componentId)
  }

  getManagedClaudeStatus(): ManagedClaudeRuntimeStatus {
    const entry = this.catalogEntry()
    return {
      componentId: 'claude-runtime',
      platform: this.platform,
      arch: this.arch,
      supported: entry !== null,
      constrainedVersion: entry?.runtimeVersion ?? null,
      availableVersion: entry?.runtimeVersion ?? null,
      updateAvailable: false,
      health: this.health,
      installedVersions: [...this.installedVersions],
      phase: this.phase,
      progress: this.progress ? { ...this.progress } : null,
      failure: this.failure ? { ...this.failure } : null,
    }
  }

  installManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult> {
    return this.startManagedClaudeOperation(() => this.performInstall(false))
  }

  checkManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult> {
    return this.startManagedClaudeOperation(async () => {
      const entry = this.catalogEntry()
      if (!entry) {
        return this.fail('PLATFORM_UNSUPPORTED', `当前不支持 ${this.platform}-${this.arch}`)
      }
      await this.refreshManagedClaudeStatus(entry, true)
      return {
        success: this.health !== 'damaged',
        status: this.getManagedClaudeStatus(),
        ...(this.health === 'damaged'
          ? {
              error: `${this.failure?.code ?? 'INSTALL_FAILED'}: ${this.failure?.message ?? '组件损坏'}`,
            }
          : {}),
      }
    })
  }

  repairManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult> {
    return this.startManagedClaudeOperation(() => this.performInstall(true))
  }

  uninstallManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult> {
    return this.startManagedClaudeOperation(async () => {
      const entry = this.catalogEntry()
      if (!entry) {
        return this.fail('PLATFORM_UNSUPPORTED', `当前不支持 ${this.platform}-${this.arch}`)
      }
      this.phase = 'uninstalling'
      this.failure = null
      this.progress = null
      try {
        await rm(this.versionRoot(entry), { recursive: true, force: true })
        await rm(this.backupRoot(entry), { recursive: true, force: true })
        this.installedVersions = []
        this.health = 'not-installed'
        this.phase = 'idle'
        return { success: true, status: this.getManagedClaudeStatus() }
      } catch (error) {
        return this.fail('INSTALL_FAILED', `Claude Runtime 卸载失败：${describeError(error)}`)
      }
    })
  }

  private startManagedClaudeOperation(
    operation: () => Promise<ManagedClaudeRuntimeOperationResult>,
  ): Promise<ManagedClaudeRuntimeOperationResult> {
    if (this.operationPromise) {
      return Promise.resolve({
        success: false,
        status: this.getManagedClaudeStatus(),
        error: 'INSTALL_BUSY: Claude Runtime 正在执行其他操作',
      })
    }
    this.operationPromise = operation().finally(() => {
      this.operationPromise = null
    })
    return this.operationPromise
  }

  async resolveManagedClaude(version: string): Promise<ResolvedManagedClaudeRuntime> {
    const entry = this.catalogEntry()
    if (!entry || version !== entry.runtimeVersion) {
      throw new RuntimeComponentInstallError(
        'PLATFORM_UNSUPPORTED',
        `当前 Studio 不允许 managed Claude Runtime ${version}`,
      )
    }
    const executablePath = await this.verifyInstalledEntry(entry)
    return {
      executablePath,
      runtimeVersion: entry.runtimeVersion,
      sdkVersion: entry.sdkVersion,
      sha256: entry.binarySha256,
      platform: entry.platform,
      arch: entry.arch,
    }
  }

  private async performInstall(force: boolean): Promise<ManagedClaudeRuntimeOperationResult> {
    const entry = this.catalogEntry()
    if (!entry) {
      return this.fail('PLATFORM_UNSUPPORTED', `当前不支持 ${this.platform}-${this.arch}`)
    }

    this.failure = null
    this.progress = null
    try {
      await mkdir(this.configRoot(entry), { recursive: true, mode: 0o700 })
      await this.recoverInterruptedReplacement(entry)
      const existing = force ? null : await this.tryResolve(entry)
      if (existing && !force) {
        this.installedVersions = [entry.runtimeVersion]
        this.health = 'healthy'
        this.phase = 'installed'
        return { success: true, status: this.getManagedClaudeStatus() }
      }

      const platformRoot = this.platformRoot(entry)
      await mkdir(platformRoot, { recursive: true, mode: 0o700 })
      const stagingRoot = join(platformRoot, `.install-${entry.runtimeVersion}-${randomUUID()}`)
      await mkdir(stagingRoot, { mode: 0o700 })
      const packagePath = join(stagingRoot, 'package.tgz')
      const executablePath = join(stagingRoot, 'claude')

      try {
        this.phase = 'downloading'
        await downloadWithRetry(
          this.download,
          entry.tarballUrl,
          packagePath,
          entry.tarballIntegrity,
          (progress) => {
            this.progress = progress
          },
        )

        this.phase = 'verifying'
        await extractClaudeBinary(packagePath, executablePath, entry)
        await chmod(executablePath, 0o700)
        await this.verifyCodeSignature(executablePath)
        const versionOutput = await this.executeVersion(executablePath)
        if (!versionOutput.includes(entry.runtimeVersion)) {
          throw new RuntimeComponentInstallError(
            'RUNTIME_VERSION_MISMATCH',
            `Claude Runtime 版本不匹配：期望 ${entry.runtimeVersion}`,
          )
        }

        this.phase = 'installing'
        await rm(packagePath, { force: true })
        await writeFile(
          join(stagingRoot, 'install-record.json'),
          JSON.stringify(createInstallRecord(entry, this.now()), null, 2),
          { encoding: 'utf8', mode: 0o600 },
        )
        await this.commitStagedVersion(entry, stagingRoot)
      } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true })
        throw error
      }

      this.installedVersions = [entry.runtimeVersion]
      this.health = 'healthy'
      this.phase = 'installed'
      this.progress = null
      return { success: true, status: this.getManagedClaudeStatus() }
    } catch (error) {
      const failure = toInstallFailure(error)
      if (force) {
        await this.refreshManagedClaudeStatus(entry, false)
        if (this.health === 'healthy') {
          this.failure = failure
          return {
            success: false,
            status: this.getManagedClaudeStatus(),
            error: `${failure.code}: ${failure.message}；已保留原版本`,
          }
        }
      }
      return this.fail(failure.code, failure.message)
    }
  }

  private fail(
    code: ManagedClaudeInstallErrorCode,
    message: string,
  ): ManagedClaudeRuntimeOperationResult {
    this.phase = 'failed'
    this.progress = null
    this.failure = { code, message }
    return {
      success: false,
      status: this.getManagedClaudeStatus(),
      error: `${code}: ${message}`,
    }
  }

  private async refreshManagedClaudeStatus(
    entry: ManagedClaudeRuntimeCatalogEntry,
    exposeCheckingPhase: boolean,
  ): Promise<void> {
    if (exposeCheckingPhase) this.phase = 'checking'
    this.progress = null
    this.failure = null
    try {
      await this.verifyInstalledEntry(entry)
      this.installedVersions = [entry.runtimeVersion]
      this.health = 'healthy'
      this.phase = 'installed'
    } catch (error) {
      this.installedVersions = []
      if (await pathExists(this.versionRoot(entry))) {
        const failure = toInstallFailure(error)
        this.health = 'damaged'
        this.phase = 'failed'
        this.failure = failure
      } else {
        this.health = 'not-installed'
        this.phase = 'idle'
      }
    }
  }

  private catalogEntry(): ManagedClaudeRuntimeCatalogEntry | null {
    return this.resolveCatalogEntry!(this.platform, this.arch)
  }

  private platformRoot(entry: ManagedClaudeRuntimeCatalogEntry): string {
    return join(this.root, entry.componentId, `${entry.platform}-${entry.arch}`)
  }

  private versionRoot(entry: ManagedClaudeRuntimeCatalogEntry): string {
    return join(this.platformRoot(entry), entry.runtimeVersion)
  }

  private configRoot(entry: ManagedClaudeRuntimeCatalogEntry): string {
    return join(this.platformRoot(entry), 'config')
  }

  private backupRoot(entry: ManagedClaudeRuntimeCatalogEntry): string {
    return join(this.platformRoot(entry), `.backup-${entry.runtimeVersion}`)
  }

  /**
   * A process can stop between moving the current version aside and publishing the staged one.
   * Prefer a valid published version; otherwise atomically restore the last verified directory.
   */
  private async recoverInterruptedReplacement(
    entry: ManagedClaudeRuntimeCatalogEntry,
  ): Promise<void> {
    const backupRoot = this.backupRoot(entry)
    if (!(await pathExists(backupRoot))) return

    try {
      await this.verifyInstalledEntry(entry)
      await rm(backupRoot, { recursive: true, force: true })
      return
    } catch {
      // The published directory is missing or invalid. Only replace it after proving the backup.
    }

    try {
      await this.verifyInstalledEntryAtRoot(entry, backupRoot)
    } catch {
      await rm(backupRoot, { recursive: true, force: true })
      return
    }

    const versionRoot = this.versionRoot(entry)
    await rm(versionRoot, { recursive: true, force: true })
    await rename(backupRoot, versionRoot)
  }

  private async commitStagedVersion(
    entry: ManagedClaudeRuntimeCatalogEntry,
    stagingRoot: string,
  ): Promise<void> {
    const versionRoot = this.versionRoot(entry)
    const backupRoot = this.backupRoot(entry)
    await rm(backupRoot, { recursive: true, force: true })
    const hadExistingVersion = await pathExists(versionRoot)

    try {
      if (hadExistingVersion) await rename(versionRoot, backupRoot)
      await rename(stagingRoot, versionRoot)
      await this.verifyInstalledEntry(entry)
      await rm(backupRoot, { recursive: true, force: true })
    } catch (error) {
      await rm(versionRoot, { recursive: true, force: true })
      if (hadExistingVersion && (await pathExists(backupRoot))) {
        await rename(backupRoot, versionRoot)
      }
      throw error
    }
  }

  private async tryResolve(entry: ManagedClaudeRuntimeCatalogEntry): Promise<string | null> {
    try {
      return await this.verifyInstalledEntry(entry)
    } catch {
      return null
    }
  }

  private async verifyInstalledEntry(entry: ManagedClaudeRuntimeCatalogEntry): Promise<string> {
    return this.verifyInstalledEntryAtRoot(entry, this.versionRoot(entry))
  }

  private async verifyInstalledEntryAtRoot(
    entry: ManagedClaudeRuntimeCatalogEntry,
    versionRoot: string,
  ): Promise<string> {
    const executablePath = join(versionRoot, 'claude')
    const recordPath = join(versionRoot, 'install-record.json')
    const record = parseInstallRecord(JSON.parse(await readFile(recordPath, 'utf8')))
    assertRecordMatchesCatalog(record, entry)
    const fileStat = await stat(executablePath)
    if (!fileStat.isFile() || fileStat.size !== entry.binarySize) {
      throw new RuntimeComponentInstallError(
        'BINARY_INTEGRITY_FAILED',
        '已安装 Claude Runtime 文件大小校验失败',
      )
    }
    if ((await sha256File(executablePath)) !== entry.binarySha256) {
      throw new RuntimeComponentInstallError(
        'BINARY_INTEGRITY_FAILED',
        '已安装 Claude Runtime SHA-256 校验失败',
      )
    }
    await chmod(executablePath, 0o700)
    return executablePath
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

async function downloadWithRetry(
  download: typeof downloadPackage,
  url: string,
  destination: string,
  integrity: string,
  onProgress: (progress: ManagedClaudeInstallProgress) => void,
): Promise<void> {
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await download(url, destination, integrity, onProgress)
      return
    } catch (error) {
      const retryable =
        error instanceof RuntimeComponentInstallError && error.code === 'DOWNLOAD_FAILED'
      if (!retryable || attempt === DOWNLOAD_ATTEMPTS) throw error
      await rm(destination, { force: true })
      onProgress({ receivedBytes: 0, totalBytes: null, percent: null })
      await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 250))
    }
  }
}

export async function downloadPackage(
  urlValue: string,
  destination: string,
  expectedIntegrity: string,
  onProgress: (progress: ManagedClaudeInstallProgress) => void,
): Promise<void> {
  const url = new URL(urlValue)
  if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new RuntimeComponentInstallError('DOWNLOAD_FAILED', '下载地址不在允许列表')
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'user-agent': 'CCLink-Studio-Runtime-Installer/1' },
  })
  if (!response.ok || !response.body) {
    throw new RuntimeComponentInstallError(
      'DOWNLOAD_FAILED',
      `npm 包下载失败：HTTP ${response.status}`,
    )
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new RuntimeComponentInstallError('DOWNLOAD_TOO_LARGE', 'npm 包超过允许大小')
  }

  const expectedDigest = parseSha512Integrity(expectedIntegrity)
  const hash = createHash('sha512')
  let receivedBytes = 0
  const tracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_DOWNLOAD_BYTES) {
        callback(new RuntimeComponentInstallError('DOWNLOAD_TOO_LARGE', 'npm 包超过允许大小'))
        return
      }
      hash.update(chunk)
      onProgress({
        receivedBytes,
        totalBytes: declaredLength,
        percent:
          declaredLength && declaredLength > 0
            ? Math.min(100, Math.round((receivedBytes / declaredLength) * 100))
            : null,
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
      `npm 包下载失败：${describeError(error)}`,
    )
  }

  if (!hash.digest().equals(expectedDigest)) {
    await rm(destination, { force: true })
    throw new RuntimeComponentInstallError('PACKAGE_INTEGRITY_FAILED', 'npm 包 integrity 校验失败')
  }
}

async function extractClaudeBinary(
  packagePath: string,
  destination: string,
  entry: ManagedClaudeRuntimeCatalogEntry,
): Promise<void> {
  const archive = extract()
  let entryCount = 0
  let expandedBytes = 0
  let binaryFound = false
  let binarySha256 = ''
  let binarySize = 0

  archive.on('entry', (header, stream, next) => {
    void (async () => {
      entryCount += 1
      expandedBytes += header.size ?? 0
      assertSafeArchiveEntry(header.name, header.type, entryCount, expandedBytes)

      if (header.name !== entry.binaryPath) {
        stream.resume()
        await new Promise<void>((resolveEntry, rejectEntry) => {
          stream.once('end', resolveEntry)
          stream.once('error', rejectEntry)
        })
        next()
        return
      }
      if (binaryFound || header.type !== 'file') {
        throw new RuntimeComponentInstallError(
          'PACKAGE_CONTENT_INVALID',
          'npm 包中 Claude Runtime 条目无效或重复',
        )
      }
      binaryFound = true
      const hash = createHash('sha256')
      const tracker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          binarySize += chunk.length
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(stream, tracker, createWriteStream(destination, { flags: 'wx', mode: 0o700 }))
      binarySha256 = hash.digest('hex')
      next()
    })().catch((error) =>
      archive.destroy(error instanceof Error ? error : new Error(String(error))),
    )
  })

  try {
    await pipeline(createReadStream(packagePath), createGunzip(), archive)
  } catch (error) {
    await rm(destination, { force: true })
    if (error instanceof RuntimeComponentInstallError) throw error
    throw new RuntimeComponentInstallError(
      'PACKAGE_CONTENT_INVALID',
      `npm 包解包失败：${describeError(error)}`,
    )
  }

  if (!binaryFound) {
    throw new RuntimeComponentInstallError(
      'PACKAGE_CONTENT_INVALID',
      'npm 包中缺少 Claude Runtime 可执行文件',
    )
  }
  if (binarySize !== entry.binarySize || binarySha256 !== entry.binarySha256) {
    await rm(destination, { force: true })
    throw new RuntimeComponentInstallError(
      'BINARY_INTEGRITY_FAILED',
      'Claude Runtime 文件大小或 SHA-256 校验失败',
    )
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

function createInstallRecord(
  entry: ManagedClaudeRuntimeCatalogEntry,
  installedAt: number,
): ManagedClaudeInstallRecord {
  return {
    schemaVersion: INSTALL_RECORD_SCHEMA_VERSION,
    componentId: entry.componentId,
    runtimeVersion: entry.runtimeVersion,
    sdkVersion: entry.sdkVersion,
    platform: entry.platform,
    arch: entry.arch,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    tarballIntegrity: entry.tarballIntegrity,
    binarySha256: entry.binarySha256,
    binarySize: entry.binarySize,
    executable: 'claude',
    installedAt,
  }
}

function parseInstallRecord(value: unknown): ManagedClaudeInstallRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeComponentInstallError('INSTALL_FAILED', '安装记录不是对象')
  }
  const record = value as Partial<ManagedClaudeInstallRecord>
  if (
    record.schemaVersion !== INSTALL_RECORD_SCHEMA_VERSION ||
    record.componentId !== 'claude-runtime' ||
    typeof record.runtimeVersion !== 'string' ||
    typeof record.sdkVersion !== 'string' ||
    record.platform !== 'darwin' ||
    (record.arch !== 'arm64' && record.arch !== 'x64') ||
    typeof record.packageName !== 'string' ||
    typeof record.packageVersion !== 'string' ||
    typeof record.tarballIntegrity !== 'string' ||
    typeof record.binarySha256 !== 'string' ||
    typeof record.binarySize !== 'number' ||
    record.executable !== 'claude' ||
    typeof record.installedAt !== 'number'
  ) {
    throw new RuntimeComponentInstallError('INSTALL_FAILED', '安装记录字段无效')
  }
  return record as ManagedClaudeInstallRecord
}

function assertRecordMatchesCatalog(
  record: ManagedClaudeInstallRecord,
  entry: ManagedClaudeRuntimeCatalogEntry,
): void {
  const expected = createInstallRecord(entry, record.installedAt)
  for (const key of Object.keys(expected) as Array<keyof ManagedClaudeInstallRecord>) {
    if (record[key] !== expected[key]) {
      throw new RuntimeComponentInstallError('INSTALL_FAILED', `安装记录与允许目录不匹配：${key}`)
    }
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseSha512Integrity(value: string): Buffer {
  if (!value.startsWith('sha512-')) {
    throw new RuntimeComponentInstallError(
      'PACKAGE_INTEGRITY_FAILED',
      '允许目录缺少 SHA-512 integrity',
    )
  }
  const digest = Buffer.from(value.slice('sha512-'.length), 'base64')
  if (digest.length !== 64) {
    throw new RuntimeComponentInstallError('PACKAGE_INTEGRITY_FAILED', 'SHA-512 integrity 无效')
  }
  return digest
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyMacCodeSignature(path: string): Promise<void> {
  try {
    await execFileAsync('codesign', ['--verify', '--strict', '--verbose=2', path], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    throw new RuntimeComponentInstallError(
      'BINARY_SIGNATURE_FAILED',
      `Claude Runtime 代码签名校验失败：${describeError(error)}`,
    )
  }
}

async function executeClaudeVersion(path: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(path, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        DISABLE_UPDATES: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    })
    return `${stdout}\n${stderr}`.trim()
  } catch (error) {
    throw new RuntimeComponentInstallError(
      'RUNTIME_VERSION_MISMATCH',
      `Claude Runtime 版本探测失败：${describeError(error)}`,
    )
  }
}

function toInstallFailure(error: unknown): ManagedClaudeInstallFailure {
  if (error instanceof RuntimeComponentInstallError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'INSTALL_FAILED', message: describeError(error) }
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}
