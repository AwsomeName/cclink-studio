import { describe, expect, it } from 'vitest'
import { parseUpdateProviderCheckResult } from './update-provider'

const sha256 = 'a'.repeat(64)

function availableResult() {
  const manifest = {
    schemaVersion: 3,
    channel: 'stable',
    tag: 'v1.2.3',
    version: '1.2.3',
    sourceSha: 'b'.repeat(40),
    minimumSystemVersion: '13.0',
    assets: {
      arm64: {
        dmg: { name: 'CCLink Studio-1.2.3-arm64.dmg', size: 100, sha256 },
      },
    },
  } as const

  return {
    status: 'available',
    release: {
      manifest,
      architecture: 'arm64',
      publishedAt: '2026-07-28T06:00:00.000Z',
      releaseNotes: 'Security and stability update.',
      prerelease: false,
      assets: {
        dmg: {
          kind: 'dmg',
          ...manifest.assets.arm64.dmg,
          downloadUrl: new URL('https://downloads.example.test/arm64.dmg'),
        },
      },
    },
  }
}

describe('UpdateProvider result contract', () => {
  it('accepts a normalized release whose assets match the manifest', () => {
    expect(parseUpdateProviderCheckResult(availableResult()).status).toBe('available')
  })

  it('rejects non-HTTPS download locations', () => {
    const result = availableResult()
    result.release.assets.dmg.downloadUrl = new URL('http://downloads.example.test/arm64.dmg')
    expect(() => parseUpdateProviderCheckResult(result)).toThrow()
  })

  it('rejects provider metadata that diverges from the manifest', () => {
    const result = availableResult()
    result.release.assets.dmg.size += 1
    expect(() => parseUpdateProviderCheckResult(result)).toThrow()
  })

  it('rejects provider-specific state from the neutral result', () => {
    expect(() =>
      parseUpdateProviderCheckResult({
        ...availableResult(),
        repository: 'owner/private-repository',
      }),
    ).toThrow()
  })
})
