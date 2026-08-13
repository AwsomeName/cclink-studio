import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pack } from 'tar-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeComponentInstallError } from './runtime-component-manager'
import { RuntimeResourceManager } from './runtime-resource-manager'
import { getRuntimeResourceCatalogEntry } from './runtime-resource-catalog'

const temporaryDirectories: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-resources-'))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function writeNpmFixture(destination: string, packageName: 'occt' | 'agent'): Promise<void> {
  const archive = pack()
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    archive.once('end', resolve)
    archive.once('error', reject)
  })
  const entry = getRuntimeResourceCatalogEntry(
    packageName === 'occt' ? 'occt-runtime' : 'agent-device-android-helpers',
  )
  for (const file of entry.files) {
    const archivePath = file.archivePath!
    const localPath =
      packageName === 'occt'
        ? join(process.cwd(), 'node_modules/occt-import-js', archivePath.replace('package/', ''))
        : join(process.cwd(), 'node_modules/agent-device', archivePath.replace('package/', ''))
    const content = await readFile(localPath)
    archive.entry({ name: archivePath, type: 'file', size: content.length }, content)
  }
  archive.finalize()
  await finished
  await writeFile(destination, gzipSync(Buffer.concat(chunks)))
}

function createFixtureManager(root: string) {
  const downloadNpm = vi.fn(async (url: string, destination: string) => {
    await writeNpmFixture(destination, url.includes('occt-import-js') ? 'occt' : 'agent')
  })
  const downloadDirect = vi.fn(
    async (
      _url: string,
      destination: string,
      _size: number,
      _sha256: string,
      onProgress: (value: {
        receivedBytes: number
        totalBytes: number | null
        percent: number | null
      }) => void,
    ) => {
      const source = join(process.cwd(), 'resources/scrcpy-server.jar')
      const content = await readFile(source)
      await writeFile(destination, content)
      onProgress({ receivedBytes: content.length, totalBytes: content.length, percent: 100 })
    },
  )
  return {
    manager: new RuntimeResourceManager(root, { downloadNpm, downloadDirect }),
    downloadNpm,
    downloadDirect,
  }
}

describe('RuntimeResourceManager', () => {
  it('installs only catalog files and reports the activation boundary', async () => {
    const root = await temporaryRoot()
    const { manager } = createFixtureManager(root)
    await manager.initialize()

    expect((await manager.install('occt-runtime')).success).toBe(true)
    expect((await manager.install('scrcpy-server')).success).toBe(true)
    expect((await manager.install('agent-device-android-helpers')).success).toBe(true)

    expect(manager.listStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: 'occt-runtime',
          installedVersion: '0.0.23',
          activation: 'domain-managed',
        }),
        expect.objectContaining({
          componentId: 'scrcpy-server',
          installedVersion: '2.3.1',
          activation: 'domain-managed',
        }),
        expect.objectContaining({
          componentId: 'agent-device-android-helpers',
          installedVersion: '0.17.2',
          activation: 'awaiting-host',
        }),
      ]),
    )
    const occt = await manager.resolve('occt-runtime')
    expect(occt?.files['occt-import-js.wasm']).toMatch(/occt-import-js\.wasm$/)
  })

  it('reuses verified userData resources after an App replacement', async () => {
    const root = await temporaryRoot()
    const first = createFixtureManager(root)
    await first.manager.initialize()
    expect((await first.manager.install('occt-runtime')).success).toBe(true)

    const second = new RuntimeResourceManager(root, {
      downloadNpm: vi.fn(async () => {
        throw new Error('must not download')
      }),
    })
    await second.initialize()

    expect(second.getStatus('occt-runtime').installedVersion).toBe('0.0.23')
    expect((await second.install('occt-runtime')).success).toBe(true)
  })

  it('refuses a damaged installed resource instead of activating it', async () => {
    const root = await temporaryRoot()
    const { manager } = createFixtureManager(root)
    await manager.initialize()
    expect((await manager.install('scrcpy-server')).success).toBe(true)
    const resolved = await manager.resolve('scrcpy-server')
    await writeFile(resolved!.files['scrcpy-server.jar'], 'damaged')

    await expect(manager.resolve('scrcpy-server')).resolves.toBeNull()
    expect(manager.getStatus('scrcpy-server').installedVersion).toBeNull()
  })

  it('checks, repairs, and uninstalls a managed resource', async () => {
    const root = await temporaryRoot()
    const { manager, downloadDirect } = createFixtureManager(root)
    await manager.initialize()
    expect((await manager.install('scrcpy-server')).success).toBe(true)
    expect(await manager.check('scrcpy-server')).toMatchObject({
      success: true,
      status: { health: 'healthy', updateAvailable: false },
    })

    const resolved = await manager.resolve('scrcpy-server')
    await writeFile(resolved!.files['scrcpy-server.jar'], 'damaged')
    expect(await manager.check('scrcpy-server')).toMatchObject({
      success: false,
      status: { health: 'damaged', phase: 'failed', installedVersion: null },
    })

    expect(await manager.repair('scrcpy-server')).toMatchObject({
      success: true,
      status: { health: 'healthy', installedVersion: '2.3.1' },
    })
    expect(downloadDirect).toHaveBeenCalledTimes(2)

    expect(await manager.uninstall('scrcpy-server')).toMatchObject({
      success: true,
      status: { health: 'not-installed', installedVersion: null, phase: 'idle' },
    })
    await expect(manager.resolve('scrcpy-server')).resolves.toBeNull()
  })

  it('keeps the verified resource when a repair download fails', async () => {
    const root = await temporaryRoot()
    const { manager, downloadDirect } = createFixtureManager(root)
    await manager.initialize()
    expect((await manager.install('scrcpy-server')).success).toBe(true)
    downloadDirect.mockRejectedValueOnce(
      new RuntimeComponentInstallError('PACKAGE_INTEGRITY_FAILED', 'replacement rejected'),
    )

    const repaired = await manager.repair('scrcpy-server')

    expect(repaired).toMatchObject({
      success: false,
      status: { health: 'healthy', installedVersion: '2.3.1' },
      error: expect.stringContaining('已保留原版本'),
    })
    await expect(manager.resolve('scrcpy-server')).resolves.toMatchObject({ version: '2.3.1' })
  })

  const realSmoke = process.env.CCLINK_RUNTIME_RESOURCES_REAL_SMOKE === '1' ? it : it.skip
  realSmoke(
    'downloads and verifies all three real catalog resources',
    async () => {
      const root = await temporaryRoot()
      const manager = new RuntimeResourceManager(root)
      await manager.initialize()
      for (const componentId of [
        'occt-runtime',
        'scrcpy-server',
        'agent-device-android-helpers',
      ] as const) {
        const result = await manager.install(componentId)
        expect(result.success, result.error).toBe(true)
      }
    },
    10 * 60 * 1000,
  )
})
