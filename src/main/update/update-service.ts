import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  UpdateArchitecture,
  UpdateCommandResult,
  UpdateErrorCode,
  UpdateInstallAndRestartInput,
  UpdateInstallPreparation,
  UpdateSnapshot,
} from '../../shared/update'
import { parseUpdateCommandResult, parseUpdateSnapshot } from '../../shared/update'
import type { ResolvedUpdateAsset, ResolvedUpdateRelease, UpdateProvider } from './update-provider'
import { UpdateProviderRequestError } from './github-release-provider'
import { compareStableVersions } from './version'

const FIRST_CHECK_DELAY_MS = 60_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const DOWNLOAD_SPACE_RESERVE_BYTES = 100 * 1024 * 1024
const PROGRESS_EMIT_INTERVAL_MS = 200

type SnapshotListener = (snapshot: UpdateSnapshot) => void
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface UpdateServiceOptions {
  currentVersion: string
  architecture: UpdateArchitecture
  systemVersion: string
  cacheRoot: string
  provider: UpdateProvider
  fetch?: FetchLike
  automaticChecks?: boolean
  firstCheckDelayMs?: number
  checkIntervalMs?: number
}

class UpdateOperationError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'UpdateOperationError'
  }
}

export class UpdateService {
  private snapshot: UpdateSnapshot
  private readonly listeners = new Set<SnapshotListener>()
  private readonly fetchImpl: FetchLike
  private readonly automaticChecks: boolean
  private readonly firstCheckDelayMs: number
  private readonly checkIntervalMs: number
  private resolvedRelease: ResolvedUpdateRelease | null = null
  private checkPromise: Promise<UpdateCommandResult> | null = null
  private checkController: AbortController | null = null
  private downloadController: AbortController | null = null
  private downloadPromise: Promise<UpdateCommandResult> | null = null
  private firstCheckTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.automaticChecks = options.automaticChecks ?? true
    this.firstCheckDelayMs = options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS
    this.snapshot = parseUpdateSnapshot({
      schemaVersion: 1,
      phase: options.provider.id === 'noop' ? 'disabled' : 'idle',
      operationId: null,
      currentVersion: options.currentVersion,
      availableRelease: null,
      progress: null,
      lastCheckedAt: null,
      ignoredVersion: null,
      error: null,
    })
  }

  async start(): Promise<void> {
    this.stopped = false
    await fs.mkdir(this.options.cacheRoot, { recursive: true, mode: 0o700 })
    await this.cleanupPartialDownloads()
    if (!this.automaticChecks || this.snapshot.phase === 'disabled') return
    this.firstCheckTimer = setTimeout(() => {
      void this.check(false)
    }, this.firstCheckDelayMs)
    this.intervalTimer = setInterval(() => {
      void this.check(false)
    }, this.checkIntervalMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.firstCheckTimer) clearTimeout(this.firstCheckTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.firstCheckTimer = null
    this.intervalTimer = null
    this.checkController?.abort()
    this.downloadController?.abort()
    await Promise.allSettled([this.checkPromise, this.downloadPromise].filter(Boolean))
    this.checkController = null
    this.downloadController = null
  }

  getSnapshot(): UpdateSnapshot {
    return structuredClone(this.snapshot)
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  check(manual = true): Promise<UpdateCommandResult> {
    if (this.checkPromise) return this.checkPromise
    if (this.snapshot.phase === 'downloading' || this.snapshot.phase === 'verifying') {
      return Promise.resolve(this.result(false))
    }
    const operationId = randomUUID()
    this.checkController = new AbortController()
    this.setSnapshot({
      ...this.snapshot,
      phase: 'checking',
      operationId,
      availableRelease: null,
      progress: null,
      error: null,
    })

    this.checkPromise = this.performCheck(operationId, manual).finally(() => {
      this.checkPromise = null
      this.checkController = null
    })
    return this.checkPromise
  }

  startDownload(): Promise<UpdateCommandResult> {
    if (this.downloadPromise) return this.downloadPromise
    const canRetryDownload =
      this.snapshot.phase === 'failed' &&
      Boolean(this.snapshot.availableRelease) &&
      this.snapshot.error?.retryable
    if ((this.snapshot.phase !== 'available' && !canRetryDownload) || !this.resolvedRelease) {
      return Promise.resolve(this.result(false))
    }

    const operationId = this.snapshot.operationId ?? randomUUID()
    this.downloadController = new AbortController()
    this.setSnapshot({
      ...this.snapshot,
      phase: 'downloading',
      operationId,
      progress: {
        fraction: 0,
        downloadedBytes: 0,
        totalBytes: this.resolvedRelease.assets.dmg.size,
        bytesPerSecond: 0,
      },
      error: null,
    })
    this.downloadPromise = this.performDownload(
      operationId,
      this.resolvedRelease,
      this.resolvedRelease.assets.dmg,
    ).finally(() => {
      this.downloadPromise = null
      this.downloadController = null
    })
    return this.downloadPromise
  }

  async cancelDownload(): Promise<UpdateCommandResult> {
    if (!this.downloadPromise || !this.downloadController) return this.result(false)
    this.downloadController.abort()
    return this.downloadPromise
  }

  defer(): UpdateCommandResult {
    if (this.snapshot.phase !== 'available') return this.result(false)
    this.setSnapshot({
      ...this.snapshot,
      phase: 'idle',
      operationId: null,
      availableRelease: null,
      progress: null,
      error: null,
    })
    return this.result(true)
  }

  ignoreVersion(): UpdateCommandResult {
    if (this.snapshot.phase !== 'available' || !this.snapshot.availableRelease) {
      return this.result(false)
    }
    this.setSnapshot({
      ...this.snapshot,
      phase: 'idle',
      operationId: null,
      availableRelease: null,
      progress: null,
      ignoredVersion: this.snapshot.availableRelease.version,
      error: null,
    })
    return this.result(true)
  }

  prepareInstall(): UpdateInstallPreparation {
    return {
      ok: false,
      confirmationToken: null,
      impacts: [],
      snapshot: this.getSnapshot(),
    }
  }

  installAndRestart(_input: UpdateInstallAndRestartInput): UpdateCommandResult {
    this.fail(
      this.snapshot.operationId ?? randomUUID(),
      new UpdateOperationError('install_blocked', '安装能力将在下一阶段接入', false),
    )
    return this.result(false)
  }

  private async performCheck(operationId: string, manual: boolean): Promise<UpdateCommandResult> {
    try {
      const result = await this.options.provider.check({
        currentVersion: this.options.currentVersion,
        channel: 'stable',
        architecture: this.options.architecture,
        signal: this.checkController!.signal,
      })
      if (this.stopped || this.snapshot.operationId !== operationId) return this.result(false)
      const checkedAt = new Date().toISOString()
      if (result.status === 'disabled') {
        this.resolvedRelease = null
        this.setSnapshot({
          ...this.snapshot,
          phase: 'disabled',
          operationId: null,
          availableRelease: null,
          progress: null,
          lastCheckedAt: checkedAt,
          error: null,
        })
        return this.result(true)
      }
      if (result.status === 'up-to-date') {
        this.resolvedRelease = null
        this.setSnapshot({
          ...this.snapshot,
          phase: 'idle',
          operationId: null,
          availableRelease: null,
          progress: null,
          lastCheckedAt: checkedAt,
          error: null,
        })
        return this.result(true)
      }

      if (
        compareStableVersions(
          normalizeSystemVersion(this.options.systemVersion),
          normalizeSystemVersion(result.release.manifest.minimumSystemVersion),
        ) < 0
      ) {
        throw new UpdateOperationError(
          'unsupported_system',
          `新版本需要 macOS ${result.release.manifest.minimumSystemVersion} 或更高版本`,
          false,
        )
      }
      this.resolvedRelease = result.release
      const ignored = this.snapshot.ignoredVersion === result.release.manifest.version
      this.setSnapshot({
        ...this.snapshot,
        phase: !manual && ignored ? 'idle' : 'available',
        operationId: !manual && ignored ? null : operationId,
        availableRelease: !manual && ignored ? null : summarizeRelease(result.release),
        progress: null,
        lastCheckedAt: checkedAt,
        error: null,
      })
      return this.result(true)
    } catch (error) {
      if (this.stopped) return this.result(false)
      this.fail(operationId, mapOperationError(error, '检查更新失败'))
      return this.result(false)
    }
  }

  private async performDownload(
    operationId: string,
    release: ResolvedUpdateRelease,
    asset: ResolvedUpdateAsset,
  ): Promise<UpdateCommandResult> {
    const releaseDirectory = join(
      this.options.cacheRoot,
      `${release.manifest.version}-${release.architecture}`,
    )
    const finalPath = join(releaseDirectory, basename(asset.name))
    const partialPath = `${finalPath}.part`
    let file: fs.FileHandle | null = null
    try {
      await fs.mkdir(releaseDirectory, { recursive: true, mode: 0o700 })
      await this.assertDiskSpace(releaseDirectory, asset.size)
      await fs.rm(partialPath, { force: true })

      const timeoutController = new AbortController()
      const timeout = setTimeout(() => timeoutController.abort(), DOWNLOAD_TIMEOUT_MS)
      let response: Response
      try {
        response = await this.fetchImpl(asset.downloadUrl, {
          redirect: 'follow',
          signal: AbortSignal.any([this.downloadController!.signal, timeoutController.signal]),
          headers: { 'User-Agent': 'CCLink-Studio-Updater' },
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!response.ok || !response.body) {
        throw new UpdateOperationError(
          response.status === 408 ? 'network_timeout' : 'network_offline',
          `下载服务返回 HTTP ${response.status}`,
          true,
        )
      }
      assertTrustedDownloadRedirect(response.url)
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (!Number.isSafeInteger(contentLength) || contentLength !== asset.size) {
        throw new UpdateOperationError('download_corrupt', '下载文件大小与更新清单不一致', true)
      }

      file = await fs.open(partialPath, 'w', 0o600)
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let downloadedBytes = 0
      let lastEmitAt = 0
      const startedAt = Date.now()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (this.downloadController!.signal.aborted) {
          throw new UpdateOperationError('download_cancelled', '下载已取消', true)
        }
        if (downloadedBytes + value.byteLength > asset.size) {
          throw new UpdateOperationError('download_corrupt', '下载文件超过清单声明大小', true)
        }
        await file.write(value)
        hash.update(value)
        downloadedBytes += value.byteLength
        const now = Date.now()
        if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS || downloadedBytes === asset.size) {
          const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001)
          this.setSnapshot({
            ...this.snapshot,
            progress: {
              fraction: downloadedBytes / asset.size,
              downloadedBytes,
              totalBytes: asset.size,
              bytesPerSecond: downloadedBytes / elapsedSeconds,
            },
          })
          lastEmitAt = now
        }
      }

      await file.sync()
      await file.close()
      file = null
      this.setSnapshot({ ...this.snapshot, phase: 'verifying', progress: null })

      const fileStat = await fs.stat(partialPath)
      if (fileStat.size !== asset.size) {
        throw new UpdateOperationError('download_corrupt', '下载文件大小校验失败', true)
      }
      const actualSha256 = hash.digest('hex')
      if (actualSha256 !== asset.sha256) {
        throw new UpdateOperationError('download_corrupt', '下载文件完整性校验失败', true)
      }
      await fs.rm(finalPath, { force: true })
      await fs.rename(partialPath, finalPath)
      await fs.writeFile(
        join(releaseDirectory, 'verified.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            version: release.manifest.version,
            architecture: release.architecture,
            asset: { name: asset.name, size: asset.size, sha256: asset.sha256 },
            verifiedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
      this.setSnapshot({
        ...this.snapshot,
        phase: 'readyToInstall',
        operationId,
        progress: null,
        error: null,
      })
      return this.result(true)
    } catch (error) {
      await file?.close().catch(() => undefined)
      await fs.rm(partialPath, { force: true }).catch(() => undefined)
      const mapped = mapOperationError(error, '下载更新失败')
      if (mapped.code === 'download_cancelled') {
        this.setSnapshot({
          ...this.snapshot,
          phase: 'available',
          operationId,
          progress: null,
          error: null,
        })
        return this.result(true)
      }
      this.fail(operationId, mapped)
      return this.result(false)
    }
  }

  private async assertDiskSpace(directory: string, assetSize: number): Promise<void> {
    const stats = await fs.statfs(directory)
    const available = stats.bavail * stats.bsize
    if (available < assetSize + DOWNLOAD_SPACE_RESERVE_BYTES) {
      throw new UpdateOperationError('disk_space_insufficient', '磁盘空间不足，无法下载更新', true)
    }
  }

  private async cleanupPartialDownloads(): Promise<void> {
    const entries = await fs.readdir(this.options.cacheRoot, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const directory = join(this.options.cacheRoot, entry.name)
          const children = await fs.readdir(directory).catch(() => [])
          await Promise.all(
            children
              .filter((name) => name.endsWith('.part'))
              .map((name) => fs.rm(join(directory, name), { force: true })),
          )
        }),
    )
  }

  private fail(operationId: string, error: UpdateOperationError): void {
    this.setSnapshot({
      ...this.snapshot,
      phase: 'failed',
      operationId,
      progress: null,
      error: {
        code: error.code,
        userMessage: error.message,
        retryable: error.retryable,
      },
    })
  }

  private setSnapshot(snapshot: UpdateSnapshot): void {
    this.snapshot = parseUpdateSnapshot(snapshot)
    const copy = this.getSnapshot()
    for (const listener of this.listeners) listener(copy)
  }

  private result(ok: boolean): UpdateCommandResult {
    return parseUpdateCommandResult({ ok, snapshot: this.getSnapshot() })
  }
}

function summarizeRelease(
  release: ResolvedUpdateRelease,
): NonNullable<UpdateSnapshot['availableRelease']> {
  const asset = release.assets.dmg
  return {
    tag: release.manifest.tag,
    version: release.manifest.version,
    channel: release.manifest.channel,
    architecture: release.architecture,
    minimumSystemVersion: release.manifest.minimumSystemVersion,
    publishedAt: release.publishedAt,
    releaseNotes: release.releaseNotes,
    asset: {
      kind: asset.kind,
      name: asset.name,
      size: asset.size,
    },
  }
}

function mapOperationError(error: unknown, fallback: string): UpdateOperationError {
  if (error instanceof UpdateOperationError) return error
  if (error instanceof UpdateProviderRequestError) {
    return new UpdateOperationError(error.kind, error.message, error.kind !== 'release_invalid')
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new UpdateOperationError('download_cancelled', '下载已取消', true)
  }
  return new UpdateOperationError('provider_unavailable', fallback, true)
}

function assertTrustedDownloadRedirect(value: string): void {
  const url = new URL(value)
  const trustedHost =
    url.hostname === 'github.com' ||
    url.hostname === 'objects.githubusercontent.com' ||
    url.hostname === 'release-assets.githubusercontent.com'
  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password) {
    throw new UpdateOperationError('release_invalid', '下载重定向地址不受信任', false)
  }
}

function normalizeSystemVersion(value: string): string {
  const parts = value.split('.').slice(0, 3)
  while (parts.length < 3) parts.push('0')
  return parts.join('.')
}
