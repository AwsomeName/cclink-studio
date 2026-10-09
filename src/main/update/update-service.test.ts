import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  UpdateProvider,
  UpdateProviderCheckInput,
  UpdateProviderCheckResult,
} from './update-provider'
import { UpdateService, type UpdateServiceOptions } from './update-service'
import { UpdateAssetVerificationError, type VerifiedDmgInspector } from './mac-dmg-verifier'
import { UpdateInstallFlushError } from './update-installer'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

function availableRelease(
  data: Buffer,
  sha256 = createHash('sha256').update(data).digest('hex'),
  prerelease = false,
) {
  const makeAsset = (kind: 'dmg', name: string, size: number) => ({
    kind,
    name,
    size,
    sha256,
    downloadUrl: new URL(
      `https://github.com/AwsomeName/cclink-studio/releases/download/v1.2.3/${name}`,
    ),
  })
  return {
    status: 'available' as const,
    release: {
      manifest: {
        schemaVersion: 3 as const,
        channel: 'stable' as const,
        tag: 'v1.2.3',
        version: '1.2.3',
        sourceSha: 'b'.repeat(40),
        minimumSystemVersion: '13.0',
        assets: {
          arm64: {
            dmg: { name: 'studio-arm64.dmg', size: data.length, sha256 },
          },
        },
      },
      architecture: 'arm64' as const,
      publishedAt: '2026-07-28T08:00:00.000Z',
      releaseNotes: 'Update notes',
      prerelease,
      assets: {
        dmg: makeAsset('dmg', 'studio-arm64.dmg', data.length),
      },
    },
  }
}

function availableReleaseAtVersion(data: Buffer, version: string) {
  const result = availableRelease(data)
  result.release.manifest.tag = `v${version}`
  result.release.manifest.version = version
  result.release.assets.dmg.downloadUrl = new URL(
    `https://github.com/AwsomeName/cclink-studio/releases/download/v${version}/studio-arm64.dmg`,
  )
  return result
}

class FixtureProvider implements UpdateProvider {
  readonly id = 'fixture'
  lastInput: UpdateProviderCheckInput | null = null

  constructor(private readonly result: UpdateProviderCheckResult) {}

  async check(input: UpdateProviderCheckInput): Promise<UpdateProviderCheckResult> {
    this.lastInput = input
    return this.result
  }
}

async function createService(
  result: UpdateProviderCheckResult,
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>,
  manualInstaller: {
    dmgInspector?: VerifiedDmgInspector
    openPath?: (path: string) => Promise<string>
    installer?: UpdateServiceOptions['installer']
    installLifecycle?: UpdateServiceOptions['installLifecycle']
  } = {},
): Promise<{ service: UpdateService; cacheRoot: string }> {
  const cacheRoot = await fs.mkdtemp(join(tmpdir(), 'cclink-update-service-'))
  temporaryDirectories.push(cacheRoot)
  const service = new UpdateService({
    currentVersion: '1.0.0',
    architecture: 'arm64',
    systemVersion: '15.0',
    cacheRoot,
    provider: new FixtureProvider(result),
    fetch: fetchImpl,
    automaticChecks: false,
    ...manualInstaller,
  })
  await service.start()
  return { service, cacheRoot }
}

describe('transactional automatic installation', () => {
  it('preserves the DMG and receipts until the new workbench and helper both acknowledge startup', async () => {
    const data = Buffer.from('boot recovery fixture')
    const result = availableRelease(data)
    const { service, cacheRoot } = await createService(result, async () => downloadResponse(data))
    await service.check()
    await service.startDownload()
    await service.stop()
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    const receiptRoot = join(cacheRoot, 'installations', 'fixture')
    await fs.mkdir(receiptRoot, { recursive: true, mode: 0o700 })
    await fs.writeFile(join(receiptRoot, 'transaction.json'), 'fixture', { mode: 0o600 })
    const acknowledgeStartup = vi.fn(async () => {})
    const next = new UpdateService({
      currentVersion: '1.2.3',
      architecture: 'arm64',
      systemVersion: '15.0',
      cacheRoot,
      provider: new FixtureProvider(result),
      automaticChecks: false,
      pendingInstallStartup: true,
      installer: { stage: vi.fn(), acknowledgeStartup },
      installLifecycle: { inspect: async () => [], flush: async () => {}, quit: vi.fn() },
    })
    await next.start()
    expect((await fs.stat(releaseDirectory)).isDirectory()).toBe(true)
    expect((await next.check()).ok).toBe(false)
    await next.acknowledgeStartup(['--cclink-update=fixture'])
    expect(acknowledgeStartup).toHaveBeenCalledOnce()
    await expect(fs.stat(releaseDirectory)).rejects.toThrow()
    expect(await fs.readFile(join(receiptRoot, 'transaction.json'), 'utf8')).toBe('fixture')
    await next.stop()
  })
  async function fixture() {
    const data = Buffer.from('signed dmg fixture')
    const staged = {
      arm: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    }
    const installer = { stage: vi.fn(async () => staged) }
    const lifecycle = {
      inspect: vi.fn(async (): Promise<import('../../shared/update').UpdateInstallImpact[]> => []),
      flush: vi.fn(async () => {}),
      quit: vi.fn(),
      acquire: vi.fn(() => vi.fn()),
    }
    const { service, cacheRoot } = await createService(
      availableRelease(data),
      async () => downloadResponse(data),
      { installer, installLifecycle: lifecycle },
    )
    await service.check()
    await service.startDownload()
    return { service, staged, installer, lifecycle, cacheRoot }
  }

  it('flushes before and after staging, then arms, commits and quits in order', async () => {
    const { service, staged, installer, lifecycle } = await fixture()
    const prepared = await service.prepareInstall()
    expect(prepared.ok).toBe(true)
    expect(installer.stage).not.toHaveBeenCalled()
    expect(lifecycle.flush).not.toHaveBeenCalled()
    const result = await service.installAndRestart({
      confirmationToken: prepared.confirmationToken!,
    })
    expect(result.ok).toBe(true)
    expect(result.snapshot.phase).toBe('installing')
    expect(installer.stage).toHaveBeenCalledOnce()
    expect(lifecycle.flush).toHaveBeenCalledTimes(2)
    expect(staged.arm).toHaveBeenCalledOnce()
    expect(staged.commit).toHaveBeenCalledOnce()
    expect(lifecycle.quit).toHaveBeenCalledOnce()
    expect(lifecycle.flush.mock.invocationCallOrder[0]).toBeLessThan(
      installer.stage.mock.invocationCallOrder[0],
    )
    expect(installer.stage.mock.invocationCallOrder[0]).toBeLessThan(
      lifecycle.flush.mock.invocationCallOrder[1],
    )
    expect(lifecycle.flush.mock.invocationCallOrder[1]).toBeLessThan(
      staged.arm.mock.invocationCallOrder[0],
    )
    expect(staged.commit.mock.invocationCallOrder[0]).toBeLessThan(
      lifecycle.quit.mock.invocationCallOrder[0],
    )
    expect(
      (await service.installAndRestart({ confirmationToken: prepared.confirmationToken! })).ok,
    ).toBe(false)
    expect((await service.setTrack('beta')).ok).toBe(false)
    await service.stop()
  })

  it('blocks dirty documents without saving or starting the helper', async () => {
    const { service, installer, lifecycle } = await fixture()
    lifecycle.inspect.mockResolvedValue([
      { kind: 'editor', severity: 'blocked', label: 'note.md', detail: '未保存' },
    ])
    const prepared = await service.prepareInstall()
    expect(prepared.ok).toBe(false)
    expect(prepared.confirmationToken).toBeNull()
    expect(prepared.impacts[0].kind).toBe('editor')
    expect(installer.stage).not.toHaveBeenCalled()
    expect(lifecycle.flush).not.toHaveBeenCalled()
    await service.stop()
  })

  it('invalidates a changed cached DMG before installing and offers a fresh check instead of a stale retry', async () => {
    const { service, installer, lifecycle, cacheRoot } = await fixture()
    const prepared = await service.prepareInstall()
    const directory = await onlyReleaseDirectory(cacheRoot)
    await fs.writeFile(join(directory, 'studio-arm64.dmg'), 'changed after download')
    const result = await service.installAndRestart({
      confirmationToken: prepared.confirmationToken!,
    })
    expect(result.ok).toBe(false)
    expect(result.snapshot.phase).toBe('failed')
    expect(result.snapshot.error?.code).toBe('download_corrupt')
    expect(result.snapshot.availableRelease).toBeNull()
    expect(installer.stage).not.toHaveBeenCalled()
    expect(lifecycle.quit).not.toHaveBeenCalled()
    expect((await service.check()).ok).toBe(true)
    await service.stop()
  })

  it('rejects a changed work scene after staging and preserves the downloaded installer', async () => {
    const { service, staged, lifecycle } = await fixture()
    const prepared = await service.prepareInstall()
    lifecycle.inspect
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ kind: 'agent', severity: 'blocked', label: 'Agent', detail: '运行中' }])
    expect(
      (await service.installAndRestart({ confirmationToken: prepared.confirmationToken! })).ok,
    ).toBe(false)
    expect(service.getSnapshot().phase).toBe('readyToInstall')
    expect(service.getSnapshot().error?.code).toBe('install_blocked')
    expect(staged.cancel).toHaveBeenCalledOnce()
    expect(staged.commit).not.toHaveBeenCalled()
    expect(lifecycle.quit).not.toHaveBeenCalled()
    await service.stop()
  })

  it.each(['preflight-flush', 'final-flush', 'arm'] as const)(
    'does not exit on %s failure and allows a fresh retry',
    async (step) => {
      const { service, staged, installer, lifecycle } = await fixture()
      const prepared = await service.prepareInstall()
      if (step === 'preflight-flush') {
        lifecycle.flush.mockRejectedValueOnce(new UpdateInstallFlushError('workspace_flush_failed'))
      } else if (step === 'final-flush') {
        lifecycle.flush
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new UpdateInstallFlushError('workspace_flush_failed'))
      } else staged.arm.mockRejectedValueOnce(new Error('helper failure'))
      expect(
        (await service.installAndRestart({ confirmationToken: prepared.confirmationToken! })).ok,
      ).toBe(false)
      expect(service.getSnapshot().phase).toBe('readyToInstall')
      if (step !== 'arm') {
        expect(service.getSnapshot().error).toMatchObject({
          code: 'install_blocked',
          userMessage: expect.stringContaining('工作现场保存失败'),
        })
      }
      if (step === 'preflight-flush') {
        expect(installer.stage).not.toHaveBeenCalled()
        expect(staged.cancel).not.toHaveBeenCalled()
      } else {
        expect(staged.cancel).toHaveBeenCalledOnce()
      }
      expect(lifecycle.quit).not.toHaveBeenCalled()
      expect((await service.prepareInstall()).ok).toBe(true)
      await service.stop()
    },
  )

  it('shows the bounded conversation persistence reason without guessing about permissions', async () => {
    const { service, installer, lifecycle } = await fixture()
    const prepared = await service.prepareInstall()
    lifecycle.flush.mockRejectedValueOnce(
      new UpdateInstallFlushError('agent_conversations_too_large'),
    )

    const result = await service.installAndRestart({
      confirmationToken: prepared.confirmationToken!,
    })

    expect(result.ok).toBe(false)
    expect(installer.stage).not.toHaveBeenCalled()
    expect(result.snapshot.error).toMatchObject({
      code: 'install_blocked',
      userMessage: expect.stringContaining('Agent 会话历史无法保存'),
    })
    expect(result.snapshot.error?.userMessage).not.toContain('替换权限')
    await service.stop()
  })

  it('rejects expired or unissued tokens', async () => {
    const { service, installer } = await fixture()
    expect((await service.installAndRestart({ confirmationToken: 'forged' })).ok).toBe(false)
    const prepared = await service.prepareInstall()
    const now = Date.now()
    const time = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    try {
      expect(
        (await service.installAndRestart({ confirmationToken: prepared.confirmationToken! })).ok,
      ).toBe(false)
    } finally {
      time.mockRestore()
    }
    expect(installer.stage).not.toHaveBeenCalled()
    await service.stop()
  })

  it('revokes confirmation on later/cancel without deleting the download or flushing user work', async () => {
    const { service, installer, lifecycle } = await fixture()
    const prepared = await service.prepareInstall()
    expect(service.defer().ok).toBe(true)
    expect(
      (await service.installAndRestart({ confirmationToken: prepared.confirmationToken! })).ok,
    ).toBe(false)
    expect(service.getSnapshot().phase).toBe('readyToInstall')
    expect(installer.stage).not.toHaveBeenCalled()
    expect(lifecycle.flush).not.toHaveBeenCalled()
    expect((await service.prepareInstall()).ok).toBe(true)
    await service.stop()
  })

  it('keeps the existing manual path when no native installer is configured', async () => {
    const data = Buffer.from('manual dmg')
    const { service } = await createService(availableRelease(data), async () =>
      downloadResponse(data),
    )
    await service.check()
    await service.startDownload()
    expect(service.getSnapshot().canInstallAutomatically).toBe(false)
    expect((await service.prepareInstall()).ok).toBe(false)
    expect(service.getSnapshot().phase).toBe('readyToInstall')
    await service.stop()
  })
})

function serviceForCache(
  result: UpdateProviderCheckResult,
  cacheRoot: string,
  currentVersion = '1.0.0',
): UpdateService {
  return new UpdateService({
    currentVersion,
    architecture: 'arm64',
    systemVersion: '15.0',
    cacheRoot,
    provider: new FixtureProvider(result),
    fetch: async () => {
      throw new Error('Restoring a verified update must not access the network')
    },
    automaticChecks: false,
  })
}

async function onlyReleaseDirectory(cacheRoot: string): Promise<string> {
  const entries = await fs.readdir(cacheRoot, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory())
  expect(directories).toHaveLength(1)
  return join(cacheRoot, directories[0].name)
}

function downloadResponse(data: Buffer): Response {
  const response = new Response(Uint8Array.from(data), {
    status: 200,
    headers: { 'content-length': String(data.length) },
  })
  Object.defineProperty(response, 'url', {
    value: 'https://release-assets.githubusercontent.com/github-production-release-asset/file',
  })
  return response
}

describe('UpdateService', () => {
  it('checks, downloads to private cache, verifies SHA-256 and reaches readyToInstall', async () => {
    const data = Buffer.from('trusted update')
    const { service, cacheRoot } = await createService(availableRelease(data), async () =>
      downloadResponse(data),
    )

    expect((await service.check()).snapshot.phase).toBe('available')
    const downloaded = await service.startDownload()

    expect(downloaded.ok).toBe(true)
    expect(downloaded.snapshot.phase).toBe('readyToInstall')
    expect(JSON.stringify(downloaded.snapshot)).not.toContain(cacheRoot)
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    await expect(fs.readFile(join(releaseDirectory, 'studio-arm64.dmg'))).resolves.toEqual(data)
    await service.stop()
  })

  it('rechecks an available candidate without hiding it and replaces it with the newer release', async () => {
    const oldData = Buffer.from('old trusted update')
    const newData = Buffer.from('new trusted update')
    const provider: UpdateProvider = {
      id: 'fixture',
      check: vi
        .fn()
        .mockResolvedValueOnce(availableReleaseAtVersion(oldData, '1.2.3'))
        .mockResolvedValueOnce(availableReleaseAtVersion(newData, '1.2.4')),
    }
    const cacheRoot = await fs.mkdtemp(join(tmpdir(), 'cclink-update-refresh-'))
    temporaryDirectories.push(cacheRoot)
    const service = new UpdateService({
      currentVersion: '1.0.0',
      architecture: 'arm64',
      systemVersion: '15.0',
      cacheRoot,
      provider,
      fetch: async () => downloadResponse(newData),
      automaticChecks: false,
    })
    await service.start()

    expect((await service.check()).snapshot.availableRelease?.version).toBe('1.2.3')
    const refreshing = service.check()
    expect(service.getSnapshot()).toMatchObject({
      phase: 'checking',
      availableRelease: { version: '1.2.3' },
      error: null,
    })

    const refreshed = await refreshing
    expect(refreshed).toMatchObject({
      ok: true,
      snapshot: {
        phase: 'available',
        availableRelease: { version: '1.2.4' },
        error: null,
      },
    })
    expect((await service.startDownload()).snapshot.phase).toBe('readyToInstall')
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    await expect(fs.readFile(join(releaseDirectory, 'studio-arm64.dmg'))).resolves.toEqual(newData)
    await service.stop()
  })

  it('keeps the available candidate and download path when a refresh fails', async () => {
    const data = Buffer.from('still trusted update')
    const provider: UpdateProvider = {
      id: 'fixture',
      check: vi
        .fn()
        .mockResolvedValueOnce(availableReleaseAtVersion(data, '1.2.3'))
        .mockRejectedValueOnce(new Error('offline')),
    }
    const cacheRoot = await fs.mkdtemp(join(tmpdir(), 'cclink-update-refresh-failure-'))
    temporaryDirectories.push(cacheRoot)
    const service = new UpdateService({
      currentVersion: '1.0.0',
      architecture: 'arm64',
      systemVersion: '15.0',
      cacheRoot,
      provider,
      fetch: async () => downloadResponse(data),
      automaticChecks: false,
    })
    await service.start()

    const first = await service.check()
    const failed = await service.check()

    expect(failed).toMatchObject({
      ok: false,
      snapshot: {
        phase: 'available',
        availableRelease: { version: '1.2.3' },
        lastCheckedAt: first.snapshot.lastCheckedAt,
        error: {
          code: 'provider_unavailable',
          userMessage: '检查更新失败',
          retryable: true,
        },
      },
    })
    expect((await service.startDownload()).snapshot.phase).toBe('readyToInstall')
    await service.stop()
  })

  it('uses the selected track and clears active release state when the track changes', async () => {
    const data = Buffer.from('trusted beta update')
    const cacheRoot = await fs.mkdtemp(join(tmpdir(), 'cclink-update-track-'))
    temporaryDirectories.push(cacheRoot)
    const provider = new FixtureProvider(availableRelease(data))
    const service = new UpdateService({
      currentVersion: '1.0.0',
      architecture: 'arm64',
      systemVersion: '15.0',
      cacheRoot,
      provider,
      initialTrack: 'beta',
      automaticChecks: false,
    })
    await service.start()

    expect((await service.check()).snapshot.track).toBe('beta')
    expect(provider.lastInput?.track).toBe('beta')
    const switched = await service.setTrack('stable')

    expect(switched.snapshot).toMatchObject({
      phase: 'idle',
      track: 'stable',
      availableRelease: null,
      lastCheckedAt: null,
    })
    await service.stop()
  })

  it('re-verifies a completed download and restores readyToInstall after restart', async () => {
    const data = Buffer.from('trusted update')
    const release = availableRelease(data)
    const { service, cacheRoot } = await createService(release, async () => downloadResponse(data))
    await service.check()
    await service.startDownload()
    await service.stop()

    const restoredService = serviceForCache(release, cacheRoot)
    await restoredService.start()

    expect(restoredService.getSnapshot()).toMatchObject({
      phase: 'readyToInstall',
      currentVersion: '1.0.0',
      availableRelease: {
        version: '1.2.3',
        architecture: 'arm64',
        asset: { name: 'studio-arm64.dmg', size: data.length },
      },
      error: null,
    })
    await restoredService.stop()
  })

  it('does not restore a prerelease cache after restarting on the stable track', async () => {
    const data = Buffer.from('trusted prerelease update')
    const release = availableRelease(data, createHash('sha256').update(data).digest('hex'), true)
    const cacheRoot = await fs.mkdtemp(join(tmpdir(), 'cclink-update-beta-cache-'))
    temporaryDirectories.push(cacheRoot)
    const betaService = new UpdateService({
      currentVersion: '1.0.0',
      architecture: 'arm64',
      systemVersion: '15.0',
      cacheRoot,
      provider: new FixtureProvider(release),
      fetch: async () => downloadResponse(data),
      initialTrack: 'beta',
      automaticChecks: false,
    })
    await betaService.start()
    await betaService.check()
    await betaService.startDownload()
    await betaService.stop()

    const stableService = serviceForCache(release, cacheRoot)
    await stableService.start()

    expect(stableService.getSnapshot()).toMatchObject({ phase: 'idle', track: 'stable' })
    await expect(fs.readdir(cacheRoot)).resolves.toEqual([])
    await stableService.stop()
  })

  it('rejects and deletes a verified cache whose DMG was changed after download', async () => {
    const data = Buffer.from('trusted update')
    const release = availableRelease(data)
    const { service, cacheRoot } = await createService(release, async () => downloadResponse(data))
    await service.check()
    await service.startDownload()
    await service.stop()
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    await fs.writeFile(join(releaseDirectory, 'studio-arm64.dmg'), 'tampered update')

    const restoredService = serviceForCache(release, cacheRoot)
    await restoredService.start()

    expect(restoredService.getSnapshot().phase).toBe('idle')
    await expect(fs.readdir(cacheRoot)).resolves.toEqual([])
    await restoredService.stop()
  })

  it('deletes a verified cache after the installed version catches up', async () => {
    const data = Buffer.from('trusted update')
    const release = availableRelease(data)
    const { service, cacheRoot } = await createService(release, async () => downloadResponse(data))
    await service.check()
    await service.startDownload()
    await service.stop()

    const restoredService = serviceForCache(release, cacheRoot, '1.2.3')
    await restoredService.start()

    expect(restoredService.getSnapshot().phase).toBe('idle')
    await expect(fs.readdir(cacheRoot)).resolves.toEqual([])
    await restoredService.stop()
  })

  it('does not block Studio startup when the update cache path is unusable', async () => {
    const data = Buffer.from('trusted update')
    const parent = await fs.mkdtemp(join(tmpdir(), 'cclink-update-cache-failure-'))
    temporaryDirectories.push(parent)
    const cacheRoot = join(parent, 'updates')
    await fs.writeFile(cacheRoot, 'not a directory')
    const service = serviceForCache(availableRelease(data), cacheRoot)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(service.start()).resolves.toBeUndefined()
    expect(service.getSnapshot().phase).toBe('idle')
    expect(consoleError).toHaveBeenCalledWith(
      '[UpdateService] 更新缓存初始化失败，已降级为空闲状态:',
      expect.anything(),
    )
    consoleError.mockRestore()
    await service.stop()
  })

  it('rejects a file whose SHA-256 differs from the manifest', async () => {
    const expected = Buffer.from('expected update')
    const corrupted = Buffer.from('corrupt update!')
    expect(corrupted.length).toBe(expected.length)
    const { service, cacheRoot } = await createService(availableRelease(expected), async () =>
      downloadResponse(corrupted),
    )

    await service.check()
    const result = await service.startDownload()

    expect(result.ok).toBe(false)
    expect(result.snapshot.phase).toBe('failed')
    expect(result.snapshot.error?.code).toBe('download_corrupt')
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    await expect(fs.stat(join(releaseDirectory, 'studio-arm64.dmg'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await service.stop()
  })

  it('cancels an active stream, deletes the part file and returns to available', async () => {
    const data = Buffer.alloc(32, 7)
    const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data.subarray(0, 8))
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          })
        },
      })
      const response = new Response(stream, {
        status: 200,
        headers: { 'content-length': String(data.length) },
      })
      Object.defineProperty(response, 'url', {
        value: 'https://release-assets.githubusercontent.com/github-production-release-asset/file',
      })
      return response
    }
    const { service, cacheRoot } = await createService(availableRelease(data), fetchImpl)
    await service.check()

    const active = service.startDownload()
    await waitFor(() => service.getSnapshot().progress?.downloadedBytes === 8)
    const cancelled = await service.cancelDownload()
    await active

    expect(cancelled.snapshot.phase).toBe('available')
    const files = await fs.readdir(await onlyReleaseDirectory(cacheRoot))
    expect(files.some((name) => name.endsWith('.part'))).toBe(false)
    await service.stop()
  })

  it('revalidates and opens only the internally verified DMG handle', async () => {
    const data = Buffer.from('trusted update')
    const verify = vi.fn(async () => undefined)
    const openPath = vi.fn(async () => '')
    const { service, cacheRoot } = await createService(
      availableRelease(data),
      async () => downloadResponse(data),
      { dmgInspector: { verify }, openPath },
    )
    await service.check()
    await service.startDownload()

    const result = await service.openManualInstaller()

    expect(result).toMatchObject({
      ok: true,
      error: null,
      snapshot: { phase: 'readyToInstall' },
    })
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    const expectedPath = join(releaseDirectory, 'studio-arm64.dmg')
    expect(verify).toHaveBeenCalledWith({
      dmgPath: expectedPath,
      expectedVersion: '1.2.3',
    })
    expect(openPath).toHaveBeenCalledWith(expectedPath)
    await service.stop()
  })

  it('keeps the trusted cache and ready state when macOS cannot open the DMG', async () => {
    const data = Buffer.from('trusted update')
    const openPath = vi.fn().mockResolvedValueOnce('open failed').mockResolvedValueOnce('')
    const { service, cacheRoot } = await createService(
      availableRelease(data),
      async () => downloadResponse(data),
      { dmgInspector: { verify: async () => undefined }, openPath },
    )
    await service.check()
    await service.startDownload()

    const failed = await service.openManualInstaller()
    const retried = await service.openManualInstaller()

    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'install_failed', retryable: true },
      snapshot: { phase: 'readyToInstall' },
    })
    expect(retried.ok).toBe(true)
    await expect(fs.readdir(cacheRoot)).resolves.toHaveLength(1)
    await service.stop()
  })

  it('invalidates a DMG changed between download and the open action', async () => {
    const data = Buffer.from('trusted update')
    const verify = vi.fn(async () => undefined)
    const { service, cacheRoot } = await createService(
      availableRelease(data),
      async () => downloadResponse(data),
      { dmgInspector: { verify }, openPath: async () => '' },
    )
    await service.check()
    await service.startDownload()
    const releaseDirectory = await onlyReleaseDirectory(cacheRoot)
    await fs.writeFile(join(releaseDirectory, 'studio-arm64.dmg'), 'tampered update')

    const result = await service.openManualInstaller()

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'download_corrupt', retryable: true },
      snapshot: { phase: 'failed' },
    })
    expect(verify).not.toHaveBeenCalled()
    await expect(fs.readdir(cacheRoot)).resolves.toEqual([])
    await service.stop()
  })

  it('invalidates a cache that fails publisher verification', async () => {
    const data = Buffer.from('trusted update')
    const { service, cacheRoot } = await createService(
      availableRelease(data),
      async () => downloadResponse(data),
      {
        dmgInspector: {
          verify: async () => {
            throw new UpdateAssetVerificationError(
              'publisher_mismatch',
              '更新安装包的发布者身份不匹配',
            )
          },
        },
        openPath: async () => '',
      },
    )
    await service.check()
    await service.startDownload()

    const result = await service.openManualInstaller()

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'publisher_mismatch', retryable: false },
      snapshot: { phase: 'failed' },
    })
    await expect(fs.readdir(cacheRoot)).resolves.toEqual([])
    await service.stop()
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for update state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
