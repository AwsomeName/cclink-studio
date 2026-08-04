import { describe, expect, it, vi } from 'vitest'
import { GitHubReleaseProvider } from './github-release-provider'

const sha256 = 'a'.repeat(64)

function manifest() {
  return {
    schemaVersion: 2,
    channel: 'stable',
    tag: 'v1.2.3',
    version: '1.2.3',
    sourceSha: 'b'.repeat(40),
    minimumSystemVersion: '13.0',
    assets: {
      arm64: {
        dmg: { name: 'CCLink-Studio-1.2.3-arm64.dmg', size: 100, sha256 },
        zip: { name: 'CCLink-Studio-1.2.3-arm64.zip', size: 90, sha256 },
      },
    },
  }
}

function release() {
  const assets = [
    { name: 'update-manifest.json', size: 500 },
    { name: 'CCLink-Studio-1.2.3-arm64.dmg', size: 100 },
    { name: 'CCLink-Studio-1.2.3-arm64.zip', size: 90 },
  ].map((asset) => ({
    ...asset,
    browser_download_url: `https://github.com/AwsomeName/cclink-studio/releases/download/v1.2.3/${asset.name}`,
  }))
  return {
    tag_name: 'v1.2.3',
    draft: false,
    prerelease: false,
    published_at: '2026-07-28T08:00:00.000Z',
    body: 'Update notes',
    assets,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GitHubReleaseProvider', () => {
  it('loads a public stable release and selects only the current architecture', async () => {
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).includes('update-manifest.json')
        ? jsonResponse(manifest())
        : jsonResponse([release()]),
    )
    const provider = new GitHubReleaseProvider({ fetch: fetchMock })

    const result = await provider.check({
      currentVersion: '1.0.0',
      track: 'stable',
      architecture: 'arm64',
      signal: new AbortController().signal,
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('Expected available release')
    expect(result.release.assets.dmg.name).toBe('CCLink-Studio-1.2.3-arm64.dmg')
    expect(result.release.assets.zip.name).toBe('CCLink-Studio-1.2.3-arm64.zip')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not expose draft or prerelease versions', async () => {
    const draft = { ...release(), draft: true }
    const prerelease = { ...release(), tag_name: 'v1.2.4', prerelease: true }
    const provider = new GitHubReleaseProvider({
      fetch: async () => jsonResponse([draft, prerelease]),
    })

    await expect(
      provider.check({
        currentVersion: '1.0.0',
        track: 'stable',
        architecture: 'arm64',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ status: 'up-to-date' })
  })

  it('exposes a public prerelease to the beta track but never exposes a draft', async () => {
    const beta = { ...release(), prerelease: true }
    const draft = { ...release(), draft: true }
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).includes('update-manifest.json')
        ? jsonResponse(manifest())
        : jsonResponse([draft, beta]),
    )
    const provider = new GitHubReleaseProvider({ fetch: fetchMock })

    const result = await provider.check({
      currentVersion: '1.0.0',
      track: 'beta',
      architecture: 'arm64',
      signal: new AbortController().signal,
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('Expected beta release')
    expect(result.release.prerelease).toBe(true)
  })

  it('rejects a release whose manifest asset is missing', async () => {
    const invalid = release()
    invalid.assets = invalid.assets.filter((asset) => asset.name !== 'update-manifest.json')
    const provider = new GitHubReleaseProvider({ fetch: async () => jsonResponse([invalid]) })

    await expect(
      provider.check({
        currentVersion: '1.0.0',
        track: 'stable',
        architecture: 'arm64',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ kind: 'manifest_invalid' })
  })
})
