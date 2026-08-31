import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pack } from 'tar-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedClaudeRuntimeCatalogEntry } from './claude-runtime-catalog'
import { RuntimeComponentInstallError, RuntimeComponentManager } from './runtime-component-manager'

const BINARY = Buffer.from('fixture-managed-claude-runtime')
const temporaryDirectories: string[] = []

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

function fixtureCatalog(): ManagedClaudeRuntimeCatalogEntry {
  return {
    componentId: 'claude-runtime',
    runtimeVersion: '2.1.211',
    sdkVersion: '0.3.211',
    platform: 'darwin',
    arch: 'arm64',
    packageName: '@anthropic-ai/claude-code-darwin-arm64',
    packageVersion: '2.1.211',
    tarballUrl: 'https://registry.npmjs.org/fixture.tgz',
    tarballIntegrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    binaryPath: 'package/claude',
    binarySha256: createHash('sha256').update(BINARY).digest('hex'),
    binarySize: BINARY.length,
  }
}

async function createFixtureTarball(path: string): Promise<void> {
  const archive = pack()
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    archive.once('end', resolve)
    archive.once('error', reject)
  })
  archive.entry({ name: 'package/claude', type: 'file', size: BINARY.length }, BINARY)
  archive.finalize()
  await finished
  await writeFile(path, gzipSync(Buffer.concat(chunks)))
}

async function createManager(
  root: string,
  download = vi.fn(async (_url, destination) => {
    await createFixtureTarball(destination)
  }),
) {
  const catalog = fixtureCatalog()
  return {
    manager: new RuntimeComponentManager(root, {
      platform: 'darwin',
      arch: 'arm64',
      download,
      verifyCodeSignature: vi.fn(async () => undefined),
      executeVersion: vi.fn(async () => '2.1.211 (Claude Code)'),
      resolveCatalogEntry: () => catalog,
      now: () => 1_723_456_789_000,
    }),
    download,
  }
}

describe('RuntimeComponentManager', () => {
  it('degrades a failed optional initialization and retries on the same owner', async () => {
    const parent = await temporaryRoot('cclink-runtime-init-degraded-')
    const root = join(parent, 'runtime-components')
    await writeFile(root, 'blocks-directory-creation')
    const manager = new RuntimeComponentManager(root, {
      resolveCatalogEntry: () => null,
    })

    await expect(manager.initialize()).rejects.toThrow()
    expect(manager.getManagedClaudeStatus()).toMatchObject({
      phase: 'failed',
      health: 'damaged',
      failure: expect.objectContaining({ code: 'INSTALL_FAILED' }),
    })

    await rm(root, { force: true })
    await expect(manager.ensureInitialized()).resolves.toBe(true)
    expect(manager.getManagedClaudeStatus()).toMatchObject({
      phase: 'idle',
      health: 'not-installed',
      failure: null,
    })
  })

  it('installs the constrained package and resolves the verified runtime', async () => {
    const root = await temporaryRoot('cclink-runtime-component-')
    const { manager, download } = await createManager(root)
    await manager.initialize()

    const result = await manager.installManagedClaude()

    expect(result.success).toBe(true)
    expect(result.status.installedVersions).toEqual(['2.1.211'])
    expect(download).toHaveBeenCalledOnce()
    const resolved = await manager.resolveManagedClaude('2.1.211')
    expect(await readFile(resolved.executablePath)).toEqual(BINARY)
    expect(resolved.sdkVersion).toBe('0.3.211')
  })

  it('retries a transient network termination without weakening integrity checks', async () => {
    const root = await temporaryRoot('cclink-runtime-download-retry-')
    const download = vi
      .fn()
      .mockRejectedValueOnce(
        new RuntimeComponentInstallError('DOWNLOAD_FAILED', 'npm 包下载失败：terminated'),
      )
      .mockImplementationOnce(async (_url, destination) => createFixtureTarball(destination))
    const { manager } = await createManager(root, download)

    const result = await manager.installManagedClaude()

    expect(result.success).toBe(true)
    expect(download).toHaveBeenCalledTimes(2)
    await expect(manager.resolveManagedClaude('2.1.211')).resolves.toMatchObject({
      runtimeVersion: '2.1.211',
    })
  })

  it('reuses the userData installation after an App replacement without downloading again', async () => {
    const root = await temporaryRoot('cclink-runtime-reuse-')
    const first = await createManager(root)
    await first.manager.initialize()
    expect((await first.manager.installManagedClaude()).success).toBe(true)

    const secondDownload = vi.fn(async () => {
      throw new Error('must not download')
    })
    const second = await createManager(root, secondDownload)
    await second.manager.initialize()

    expect(second.manager.getManagedClaudeStatus().phase).toBe('installed')
    expect((await second.manager.installManagedClaude()).success).toBe(true)
    expect(secondDownload).not.toHaveBeenCalled()
  })

  it('checks, repairs, and uninstalls the managed runtime while preserving its config', async () => {
    const root = await temporaryRoot('cclink-runtime-lifecycle-')
    const { manager, download } = await createManager(root)
    await manager.initialize()
    expect((await manager.installManagedClaude()).success).toBe(true)

    const healthy = await manager.checkManagedClaude()
    expect(healthy).toMatchObject({
      success: true,
      status: { health: 'healthy', updateAvailable: false },
    })
    expect(download).toHaveBeenCalledTimes(1)

    const executablePath = join(root, 'claude-runtime', 'darwin-arm64', '2.1.211', 'claude')
    await writeFile(executablePath, 'damaged')
    const damaged = await manager.checkManagedClaude()
    expect(damaged).toMatchObject({
      success: false,
      status: { health: 'damaged', phase: 'failed', installedVersions: [] },
    })

    const repaired = await manager.repairManagedClaude()
    expect(repaired).toMatchObject({
      success: true,
      status: { health: 'healthy', installedVersions: ['2.1.211'] },
    })
    expect(download).toHaveBeenCalledTimes(2)

    const configPath = join(root, 'claude-runtime', 'darwin-arm64', 'config', 'keep-me.json')
    await writeFile(configPath, '{}')
    const uninstalled = await manager.uninstallManagedClaude()
    expect(uninstalled).toMatchObject({
      success: true,
      status: { health: 'not-installed', installedVersions: [], phase: 'idle' },
    })
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{}')
    await expect(manager.resolveManagedClaude('2.1.211')).rejects.toThrow()
  })

  it('restores the previous installation when final publish verification fails', async () => {
    const root = await temporaryRoot('cclink-runtime-rollback-')
    const first = await createManager(root)
    await first.manager.initialize()
    expect((await first.manager.installManagedClaude()).success).toBe(true)

    const catalog = fixtureCatalog()
    const replacement = new RuntimeComponentManager(root, {
      platform: 'darwin',
      arch: 'arm64',
      download: vi.fn(async (_url, destination) => createFixtureTarball(destination)),
      verifyCodeSignature: vi.fn(async () => undefined),
      executeVersion: vi.fn(async () => '2.1.211 (Claude Code)'),
      resolveCatalogEntry: () => catalog,
      now: () => 1_800_000_000_000,
    })
    const verifySpy = vi.spyOn(
      replacement as unknown as {
        verifyInstalledEntry: (entry: ManagedClaudeRuntimeCatalogEntry) => Promise<string>
      },
      'verifyInstalledEntry',
    )
    // The first verification belongs to the same-owner initialization retry, the second probes
    // the existing install, and the third validates the newly published replacement.
    verifySpy.mockRejectedValueOnce(new Error('force reinstall'))
    verifySpy.mockRejectedValueOnce(new Error('force reinstall after initialization retry'))
    verifySpy.mockRejectedValueOnce(new Error('post-publish verification failed'))

    const failed = await replacement.installManagedClaude()

    expect(failed.success).toBe(false)
    verifySpy.mockRestore()
    const restoredRecord = JSON.parse(
      await readFile(
        join(root, 'claude-runtime', 'darwin-arm64', '2.1.211', 'install-record.json'),
        'utf8',
      ),
    ) as { installedAt: number }
    expect(restoredRecord.installedAt).toBe(1_723_456_789_000)

    const restarted = await createManager(root)
    await restarted.manager.initialize()
    expect(restarted.manager.getManagedClaudeStatus().phase).toBe('installed')
    await expect(restarted.manager.resolveManagedClaude('2.1.211')).resolves.toMatchObject({
      runtimeVersion: '2.1.211',
    })
  })

  it('recovers the verified backup after a process stops during replacement', async () => {
    const root = await temporaryRoot('cclink-runtime-crash-recovery-')
    const first = await createManager(root)
    await first.manager.initialize()
    expect((await first.manager.installManagedClaude()).success).toBe(true)

    const platformRoot = join(root, 'claude-runtime', 'darwin-arm64')
    await rename(join(platformRoot, '2.1.211'), join(platformRoot, '.backup-2.1.211'))

    const restarted = await createManager(root)
    await restarted.manager.initialize()

    expect(restarted.manager.getManagedClaudeStatus().phase).toBe('installed')
    await expect(restarted.manager.resolveManagedClaude('2.1.211')).resolves.toMatchObject({
      runtimeVersion: '2.1.211',
    })
  })

  it('rejects a package whose extracted binary does not match the catalog', async () => {
    const root = await temporaryRoot('cclink-runtime-invalid-')
    const catalog = fixtureCatalog()
    catalog.binarySha256 = '0'.repeat(64)
    const manager = new RuntimeComponentManager(root, {
      platform: 'darwin',
      arch: 'arm64',
      download: vi.fn(async (_url, destination) => createFixtureTarball(destination)),
      verifyCodeSignature: vi.fn(async () => undefined),
      executeVersion: vi.fn(async () => '2.1.211'),
      resolveCatalogEntry: () => catalog,
    })

    const result = await manager.installManagedClaude()

    expect(result.success).toBe(false)
    expect(result.status.failure?.code).toBe('BINARY_INTEGRITY_FAILED')
    await expect(manager.resolveManagedClaude('2.1.211')).rejects.toThrow()
  })

  const realSmoke = process.env.CCLINK_MANAGED_RUNTIME_REAL_SMOKE === '1' ? it : it.skip
  realSmoke(
    'downloads the real constrained npm package and reuses it after App replacement',
    async () => {
      const root = await temporaryRoot('cclink-runtime-real-')
      const firstApp = new RuntimeComponentManager(root)
      await firstApp.initialize()

      const installed = await firstApp.installManagedClaude()

      expect(installed.success, installed.error).toBe(true)
      expect(installed.status.installedVersions).toEqual(['2.1.211'])
      const firstResolved = await firstApp.resolveManagedClaude('2.1.211')

      const replacementApp = new RuntimeComponentManager(root)
      await replacementApp.initialize()
      const reused = await replacementApp.installManagedClaude()
      const secondResolved = await replacementApp.resolveManagedClaude('2.1.211')

      expect(reused.success, reused.error).toBe(true)
      expect(secondResolved).toEqual(firstResolved)
      expect(secondResolved.sdkVersion).toBe('0.3.211')
    },
    10 * 60 * 1000,
  )
})
