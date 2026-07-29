import { describe, expect, it } from 'vitest'
import { parseUpdateManifest, updateManifestSchema } from './manifest-schema'

const sha = 'a'.repeat(64)

function validManifest() {
  return {
    schemaVersion: 1,
    channel: 'stable',
    tag: 'v1.2.3',
    version: '1.2.3',
    sourceSha: 'b'.repeat(40),
    minimumSystemVersion: '13.0',
    assets: {
      arm64: {
        dmg: { name: 'CCLink-Studio-1.2.3-arm64.dmg', size: 100, sha256: sha },
        zip: { name: 'CCLink-Studio-1.2.3-arm64.zip', size: 90, sha256: sha },
      },
      x64: {
        dmg: { name: 'CCLink-Studio-1.2.3-x64.dmg', size: 101, sha256: sha },
        zip: { name: 'CCLink-Studio-1.2.3-x64.zip', size: 91, sha256: sha },
      },
    },
  }
}

describe('updateManifestSchema', () => {
  it('accepts a complete stable cross-architecture manifest', () => {
    expect(parseUpdateManifest(validManifest())).toEqual(validManifest())
  })

  it('rejects a missing architecture', () => {
    const manifest = validManifest()
    Reflect.deleteProperty(manifest.assets, 'x64')
    expect(updateManifestSchema.safeParse(manifest).success).toBe(false)
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

  it('rejects unsafe asset names and duplicate architecture assets', () => {
    const unsafe = validManifest()
    unsafe.assets.arm64.dmg.name = '../CCLink-Studio.dmg'
    expect(updateManifestSchema.safeParse(unsafe).success).toBe(false)

    const urlLike = validManifest()
    urlLike.assets.arm64.dmg.name = 'https:CCLink-Studio.dmg'
    expect(updateManifestSchema.safeParse(urlLike).success).toBe(false)

    const duplicate = validManifest()
    duplicate.assets.x64.dmg.name = duplicate.assets.arm64.dmg.name
    expect(updateManifestSchema.safeParse(duplicate).success).toBe(false)
  })

  it('rejects stable versions with leading zeroes', () => {
    const manifest = { ...validManifest(), version: '01.2.3', tag: 'v01.2.3' }
    expect(updateManifestSchema.safeParse(manifest).success).toBe(false)
  })
})
