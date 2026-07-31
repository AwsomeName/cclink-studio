import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateUpdateManifest, verifyUpdateManifestDirectory } from './update-manifest-lib.mjs'
import { runVerifyUpdateManifest } from './verify-update-manifest.mjs'

const sourceSha = 'a'.repeat(40)
const releaseWorkflowSha = 'b'.repeat(40)
const generateScript = fileURLToPath(new URL('./generate-update-manifest.mjs', import.meta.url))
const verifyScript = fileURLToPath(new URL('./verify-update-manifest.mjs', import.meta.url))

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function createFixture({ version = '1.2.3', tag = `v${version}` } = {}) {
  const assetsDir = mkdtempSync(resolve(tmpdir(), 'cclink-update-manifest-'))
  mkdirSync(assetsDir, { recursive: true })
  const arch = 'arm64'
  const entries = []
  for (const extension of ['dmg', 'zip']) {
    const name = `CCLink-Studio-${version}-${arch}.${extension}`
    const content = `${arch}-${extension}-fixture`
    writeFileSync(resolve(assetsDir, name), content)
    entries.push(`${sha256(content)}  ./${name}`)
  }
  writeFileSync(resolve(assetsDir, `checksums-${arch}.txt`), `${entries.join('\n')}\n`)
  writeFileSync(
    resolve(assetsDir, `build-record-${arch}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tag,
        version,
        arch,
        sourceSha,
        releaseWorkflowSha,
        workflowRunId: '12345',
      },
      null,
      2,
    )}\n`,
  )
  return assetsDir
}

test('generates a deterministic manifest from real assets and build records', async () => {
  const assetsDir = createFixture()
  const first = await generateUpdateManifest({ assetsDir, tag: 'v1.2.3' })
  const second = await generateUpdateManifest({ assetsDir, tag: 'v1.2.3' })
  assert.deepEqual(first, second)
  assert.equal(first.schemaVersion, 2)
  assert.equal(first.version, '1.2.3')
  assert.equal(
    first.assets.arm64.dmg.size,
    readFileSync(resolve(assetsDir, first.assets.arm64.dmg.name)).length,
  )
  assert.equal(first.assets.arm64.zip.sha256.length, 64)
  assert.deepEqual(Object.keys(first.assets), ['arm64'])
})

test('CLI generates and independently verifies a manifest before release upload', () => {
  const assetsDir = createFixture()
  const manifestPath = resolve(assetsDir, 'update-manifest.json')
  execFileSync(
    process.execPath,
    [
      generateScript,
      '--assets-dir',
      assetsDir,
      '--tag',
      'v1.2.3',
      '--release-workflow-sha',
      releaseWorkflowSha,
      '--workflow-run-id',
      '12345',
      '--output',
      manifestPath,
    ],
    { encoding: 'utf8' },
  )
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.tag, 'v1.2.3')
  assert.match(
    execFileSync(
      process.execPath,
      [
        verifyScript,
        '--assets-dir',
        assetsDir,
        '--manifest',
        manifestPath,
        '--tag',
        'v1.2.3',
        '--release-workflow-sha',
        releaseWorkflowSha,
        '--workflow-run-id',
        '12345',
      ],
      { encoding: 'utf8' },
    ),
    /Update Manifest verified: v1\.2\.3/,
  )
})

test('verifier accepts the pnpm argument separator', async () => {
  const assetsDir = createFixture()
  const manifestPath = resolve(assetsDir, 'update-manifest.json')
  const manifest = await generateUpdateManifest({ assetsDir, tag: 'v1.2.3' })
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const verified = await runVerifyUpdateManifest([
    '--',
    '--assets-dir',
    assetsDir,
    '--manifest',
    manifestPath,
    '--tag',
    'v1.2.3',
  ])
  assert.equal(verified.tag, 'v1.2.3')
})

test('rejects a missing arm64 build record before a draft can be created', async () => {
  const assetsDir = createFixture()
  writeFileSync(resolve(assetsDir, 'build-record-arm64.json'), '{}\n')
  await assert.rejects(
    generateUpdateManifest({ assetsDir, tag: 'v1.2.3' }),
    /build-record-arm64\.json keys/,
  )
})

test('rejects an arm64 build record with the wrong source metadata', async () => {
  const assetsDir = createFixture()
  const recordPath = resolve(assetsDir, 'build-record-arm64.json')
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  writeFileSync(
    recordPath,
    `${JSON.stringify({ ...record, releaseWorkflowSha: 'c'.repeat(40) }, null, 2)}\n`,
  )
  await assert.rejects(
    generateUpdateManifest({
      assetsDir,
      tag: 'v1.2.3',
      expectedReleaseWorkflowSha: releaseWorkflowSha,
    }),
    /current release workflow commit/,
  )
})

test('rejects build records from another workflow commit or run', async () => {
  const assetsDir = createFixture()
  await assert.rejects(
    generateUpdateManifest({
      assetsDir,
      tag: 'v1.2.3',
      expectedReleaseWorkflowSha: 'c'.repeat(40),
    }),
    /current release workflow commit/,
  )
  await assert.rejects(
    generateUpdateManifest({
      assetsDir,
      tag: 'v1.2.3',
      expectedWorkflowRunId: '99999',
    }),
    /current workflow run/,
  )
})

test('rejects a checksum that does not match the actual asset', async () => {
  const assetsDir = createFixture()
  const checksumPath = resolve(assetsDir, 'checksums-arm64.txt')
  writeFileSync(
    checksumPath,
    readFileSync(checksumPath, 'utf8').replace(/^[0-9a-f]{64}/, '0'.repeat(64)),
  )
  await assert.rejects(
    generateUpdateManifest({ assetsDir, tag: 'v1.2.3' }),
    /asset checksum mismatch/,
  )
})

test('rejects unsafe asset names and stable prerelease tags', async () => {
  const assetsDir = createFixture()
  const checksumPath = resolve(assetsDir, 'checksums-arm64.txt')
  writeFileSync(
    checksumPath,
    `${readFileSync(checksumPath, 'utf8').replace('./CCLink', '../CCLink')}`,
  )
  await assert.rejects(generateUpdateManifest({ assetsDir, tag: 'v1.2.3' }), /unsafe asset name/)
  await assert.rejects(
    generateUpdateManifest({
      assetsDir: createFixture({ version: '1.2.3-beta.1' }),
      tag: 'v1.2.3-beta.1',
    }),
    /stable vX\.Y\.Z/,
  )
  await assert.rejects(
    generateUpdateManifest({
      assetsDir: createFixture({ version: '01.2.3' }),
      tag: 'v01.2.3',
    }),
    /stable vX\.Y\.Z/,
  )
})

test('rejects a symlink disguised as a release asset', async () => {
  const assetsDir = createFixture()
  const assetPath = resolve(assetsDir, 'CCLink-Studio-1.2.3-arm64.dmg')
  const targetPath = `${assetPath}.target`
  renameSync(assetPath, targetPath)
  symlinkSync(targetPath, assetPath)
  await assert.rejects(generateUpdateManifest({ assetsDir, tag: 'v1.2.3' }), /not a regular file/)
})

test('verifier rebuilds the manifest and rejects tampered metadata', async () => {
  const assetsDir = createFixture()
  const manifest = await generateUpdateManifest({ assetsDir, tag: 'v1.2.3' })
  assert.deepEqual(
    await verifyUpdateManifestDirectory({ assetsDir, manifest, expectedTag: 'v1.2.3' }),
    manifest,
  )
  await assert.rejects(
    verifyUpdateManifestDirectory({
      assetsDir,
      manifest: {
        ...manifest,
        assets: {
          ...manifest.assets,
          arm64: {
            ...manifest.assets.arm64,
            dmg: { ...manifest.assets.arm64.dmg, size: manifest.assets.arm64.dmg.size + 1 },
          },
        },
      },
    }),
    /does not match/,
  )
})
