import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UpdateProvider, UpdateProviderCheckResult } from './update-provider'
import { UpdateService } from './update-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

function availableRelease(data: Buffer, sha256 = createHash('sha256').update(data).digest('hex')) {
  const makeAsset = (kind: 'dmg' | 'zip', name: string, size: number) => ({
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
        schemaVersion: 1 as const,
        channel: 'stable' as const,
        tag: 'v1.2.3',
        version: '1.2.3',
        sourceSha: 'b'.repeat(40),
        minimumSystemVersion: '13.0',
        assets: {
          arm64: {
            dmg: { name: 'studio-arm64.dmg', size: data.length, sha256 },
            zip: { name: 'studio-arm64.zip', size: data.length, sha256 },
          },
          x64: {
            dmg: { name: 'studio-x64.dmg', size: data.length, sha256 },
            zip: { name: 'studio-x64.zip', size: data.length, sha256 },
          },
        },
      },
      architecture: 'arm64' as const,
      publishedAt: '2026-07-28T08:00:00.000Z',
      releaseNotes: 'Update notes',
      assets: {
        dmg: makeAsset('dmg', 'studio-arm64.dmg', data.length),
        zip: makeAsset('zip', 'studio-arm64.zip', data.length),
      },
    },
  }
}

class FixtureProvider implements UpdateProvider {
  readonly id = 'fixture'

  constructor(private readonly result: UpdateProviderCheckResult) {}

  async check(): Promise<UpdateProviderCheckResult> {
    return this.result
  }
}

async function createService(
  result: UpdateProviderCheckResult,
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>,
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
  })
  await service.start()
  return { service, cacheRoot }
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
    await expect(fs.readFile(join(cacheRoot, '1.2.3-arm64', 'studio-arm64.dmg'))).resolves.toEqual(
      data,
    )
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
    await expect(fs.stat(join(cacheRoot, '1.2.3-arm64', 'studio-arm64.dmg'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
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
    const files = await fs.readdir(join(cacheRoot, '1.2.3-arm64'))
    expect(files.some((name) => name.endsWith('.part'))).toBe(false)
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
