import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type {
  UpdateArchitecture,
  UpdateCommandResult,
  UpdateErrorCode,
  UpdateInstallAndRestartInput,
  UpdateInstallPreparation,
  UpdateManualInstallerResult,
  UpdateSnapshot,
  UpdateTrack,
} from '../../shared/update'
import {
  parseUpdateCommandResult,
  parseUpdateManualInstallerResult,
  parseUpdateSnapshot,
} from '../../shared/update'
import type { ResolvedUpdateAsset, ResolvedUpdateRelease, UpdateProvider } from './update-provider'
import { UpdateProviderRequestError } from './github-release-provider'
import { UpdateCache, type RestoredVerifiedUpdate } from './update-cache'
import { compareStableVersions } from './version'
import { UpdateAssetVerificationError, type VerifiedDmgInspector } from './mac-dmg-verifier'

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
  initialTrack?: UpdateTrack
  fetch?: FetchLike
  automaticChecks?: boolean
  firstCheckDelayMs?: number
  checkIntervalMs?: number
  dmgInspector?: VerifiedDmgInspector
  openPath?: (path: string) => Promise<string>
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
  private readonly updateCache: UpdateCache
  private resolvedRelease: ResolvedUpdateRelease | null = null
  private verifiedUpdate: RestoredVerifiedUpdate | null = null
  private checkPromise: Promise<UpdateCommandResult> | null = null
  private checkController: AbortController | null = null
  private downloadController: AbortController | null = null
  private downloadPromise: Promise<UpdateCommandResult> | null = null
  private firstCheckTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private manualInstallerPromise: Promise<UpdateManualInstallerResult> | null = null
  private stopped = false

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.automaticChecks = options.automaticChecks ?? true
    this.firstCheckDelayMs = options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS
    this.updateCache = new UpdateCache({
      cacheRoot: options.cacheRoot,
      currentVersion: options.currentVersion,
      track: options.initialTrack ?? 'stable',
      architecture: options.architecture,
      systemVersion: options.systemVersion,
    })
    this.snapshot = parseUpdateSnapshot({
      schemaVersion: 1,
      phase: options.provider.id === 'noop' ? 'disabled' : 'idle',
      operationId: null,
      currentVersion: options.currentVersion,
      track: options.initialTrack ?? 'stable',
      availableRelease: null,
      progress: null,
      lastCheckedAt: null,
      ignoredVersion: null,
      error: null,
    })
  }

  async start(): Promise<void> {
    this.stopped = false
    try {
      await this.updateCache.start()
      if (this.snapshot.phase !== 'disabled') {
        this.verifiedUpdate = await this.updateCache.restore()
        if (this.verifiedUpdate) {
          this.setSnapshot({
            ...this.snapshot,
            phase: 'readyToInstall',
            operationId: randomUUID(),
            availableRelease: this.verifiedUpdate.releaseSummary,
            progress: null,
            error: null,
          })
        }
      }
    } catch (error) {
      console.error('[UpdateService] 更新缓存初始化失败，已降级为空闲状态:', error)
    }
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

  async setTrack(track: UpdateTrack): Promise<UpdateCommandResult> {
    if (track === this.snapshot.track) return this.result(true)

    this.checkController?.abort()
    this.downloadController?.abort()
    const cached = this.verifiedUpdate
    this.resolvedRelease = null
    this.verifiedUpdate = null
    this.updateCache.setTrack(track)
    this.setSnapshot({
      ...this.snapshot,
      phase: this.options.provider.id === 'noop' ? 'disabled' : 'idle',
      operationId: null,
      track,
      availableRelease: null,
      progress: null,
      lastCheckedAt: null,
      ignoredVersion: null,
      error: null,
    })
    await Promise.allSettled([this.checkPromise, this.downloadPromise].filter(Boolean))
    if (cached) {
      await this.updateCache.invalidate(cached).catch((error) => {
        console.warn('[UpdateService] 切换更新轨道时清理缓存失败:', error)
      })
    }
    return this.result(true)
  }

  check(manual = true): Promise<UpdateCommandResult> {
    if (this.checkPromise) return this.checkPromise
    if (this.snapshot.phase === 'readyToInstall') {
      return Promise.resolve(this.result(true))
    }
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

  openManualInstaller(): Promise<UpdateManualInstallerResult> {
    if (this.manualInstallerPromise) return this.manualInstallerPromise
    this.manualInstallerPromise = this.performOpenManualInstaller().finally(() => {
      this.manualInstallerPromise = null
    })
    return this.manualInstallerPromise
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
      new UpdateOperationError(
        'install_blocked',
        '自动安装尚未通过安全验收，请使用可信 DMG 手工安装',
        false,
      ),
    )
    return this.result(false)
  }

  private async performOpenManualInstaller(): Promise<UpdateManualInstallerResult> {
    const candidate = this.verifiedUpdate
    if (
      this.snapshot.phase !== 'readyToInstall' ||
      !this.snapshot.availableRelease ||
      !candidate ||
      !this.options.dmgInspector ||
      !this.options.openPath
    ) {
      return this.manualInstallerResult(
        false,
        new UpdateOperationError('install_blocked', '当前构建无法验证并打开更新安装包', false),
      )
    }

    try {
      this.verifiedUpdate = await this.updateCache.revalidate(candidate)
    } catch {
      this.verifiedUpdate = null
      this.fail(
        this.snapshot.operationId ?? randomUUID(),
        new UpdateOperationError(
          'download_corrupt',
          '更新安装包在打开前的完整性复验失败，请重新下载',
          true,
        ),
      )
      return this.manualInstallerResult(
        false,
        new UpdateOperationError(
          'download_corrupt',
          '更新安装包在打开前的完整性复验失败，请重新下载',
          true,
        ),
      )
    }

    try {
      await this.options.dmgInspector.verify({
        dmgPath: this.verifiedUpdate.filePath,
        expectedVersion: this.verifiedUpdate.record.manifest.version,
      })
    } catch (error) {
      const mapped =
        error instanceof UpdateAssetVerificationError
          ? new UpdateOperationError(error.code, error.message, false)
          : new UpdateOperationError('publisher_mismatch', '更新安装包未通过发布者身份检查', false)
      if (mapped.code !== 'install_failed') {
        await this.updateCache.invalidate(this.verifiedUpdate).catch(() => undefined)
        this.verifiedUpdate = null
        this.fail(this.snapshot.operationId ?? randomUUID(), mapped)
      }
      return this.manualInstallerResult(false, mapped)
    }

    let openError = ''
    try {
      openError = await this.options.openPath(this.verifiedUpdate.filePath)
    } catch {
      openError = 'openPath failed'
    }
    if (openError) {
      return this.manualInstallerResult(
        false,
        new UpdateOperationError('install_failed', 'macOS 未能打开更新安装包，请重试', true),
      )
    }
    return this.manualInstallerResult(true, null)
  }

  private async performCheck(operationId: string, manual: boolean): Promise<UpdateCommandResult> {
    try {
      const result = await this.options.provider.check({
        currentVersion: this.options.currentVersion,
        track: this.snapshot.track,
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
      if (this.snapshot.operationId !== operationId) return this.result(false)
      this.fail(operationId, mapOperationError(error, '检查更新失败'))
      return this.result(false)
    }
  }

  private async performDownload(
    operationId: string,
    release: ResolvedUpdateRelease,
    asset: ResolvedUpdateAsset,
  ): Promise<UpdateCommandResult> {
    const target = this.updateCache.createDownloadTarget(release, asset)
    const { directory: releaseDirectory, finalPath, partialPath } = target
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
      this.verifiedUpdate = await this.updateCache.commitVerified(release, asset, finalPath)
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
      if (this.snapshot.operationId !== operationId) return this.result(false)
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

  private manualInstallerResult(
    ok: boolean,
    error: UpdateOperationError | null,
  ): UpdateManualInstallerResult {
    return parseUpdateManualInstallerResult({
      ok,
      error: error
        ? {
            code: error.code,
            userMessage: error.message,
            retryable: error.retryable,
          }
        : null,
      snapshot: this.getSnapshot(),
    })
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
    prerelease: release.prerelease,
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
