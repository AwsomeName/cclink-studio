import { describe, expect, it } from 'vitest'
import { parseUpdateManifest, updateManifestSchema } from './manifest-schema'

const sha = 'a'.repeat(64)

function validManifest() {
  return {
    schemaVersion: 3,
    channel: 'stable',
    tag: 'v1.2.3',
    version: '1.2.3',
    sourceSha: 'b'.repeat(40),
    minimumSystemVersion: '13.0',
    assets: {
      arm64: {
        dmg: { name: 'CCLink-Studio-1.2.3-arm64.dmg', size: 100, sha256: sha },
      },
    },
  }
}

describe('updateManifestSchema', () => {
  it('accepts a complete stable arm64 manifest', () => {
    expect(parseUpdateManifest(validManifest())).toEqual(validManifest())
  })

  it('rejects historical architectures and manifest versions', () => {
    const manifest = {
      ...validManifest(),
      assets: {
        ...validManifest().assets,
        x64: {
          dmg: { name: 'CCLink-Studio-1.2.3-x64.dmg', size: 101, sha256: sha },
        },
      },
    }
    expect(updateManifestSchema.safeParse(manifest).success).toBe(false)
    expect(updateManifestSchema.safeParse({ ...validManifest(), schemaVersion: 1 }).success).toBe(
      false,
    )
  })

  it('rejects tag and version mismatches', () => {
    expect(updateManifestSchema.safeParse({ ...validManifest(), tag: 'v1.2.4' }).success).toBe(
      false,
    )
  })

  it('rejects prerelease versions on the stable channel', () => {
    const manifest = { ...validManifest(), version: '1.2.3-beta.1', tag: 'v1.2.3-beta.1' }
    expect(updateManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('rejects unsafe arm64 asset names', () => {
    const unsafe = validManifest()
    unsafe.assets.arm64.dmg.name = '../CCLink-Studio.dmg'
    expect(updateManifestSchema.safeParse(unsafe).success).toBe(false)

    const urlLike = validManifest()
    urlLike.assets.arm64.dmg.name = 'https:CCLink-Studio.dmg'
    expect(updateManifestSchema.safeParse(urlLike).success).toBe(false)
  })

  it('rejects stable versions with leading zeroes', () => {
    const manifest = { ...validManifest(), version: '01.2.3', tag: 'v01.2.3' }
    expect(updateManifestSchema.safeParse(manifest).success).toBe(false)
  })
})
