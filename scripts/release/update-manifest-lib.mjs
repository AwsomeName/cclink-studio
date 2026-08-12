import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const ARCHITECTURE = 'arm64'
const ASSET_KINDS = ['dmg']
const STABLE_VERSION_SOURCE = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)'
const STABLE_VERSION_PATTERN = new RegExp(`^${STABLE_VERSION_SOURCE}$`)
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SYSTEM_VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/
const SAFE_ASSET_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*$/u
const MAX_ASSET_BYTES = 8 * 1024 * 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must be exactly: ${wanted.join(', ')}`)
  }
}

function readJson(path, label) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`${label} is missing or invalid JSON: ${basename(path)}`)
  }
  return parsed
}

function parseChecksums(path, arch) {
  const entries = new Map()
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line)
    if (!match) fail(`checksums-${arch}.txt contains an invalid line`)
    const name = match[2].replace(/^\.\//, '')
    if (!SAFE_ASSET_NAME_PATTERN.test(name) || name !== basename(name)) {
      fail(`checksums-${arch}.txt contains an unsafe asset name`)
    }
    if (entries.has(name)) fail(`checksums-${arch}.txt contains a duplicate asset`)
    entries.set(name, match[1])
  }
  return entries
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function validateBuildRecord(record, arch, tag) {
  assertExactKeys(
    record,
    ['schemaVersion', 'tag', 'version', 'arch', 'sourceSha', 'releaseWorkflowSha', 'workflowRunId'],
    `build-record-${arch}.json`,
  )
  if (record.schemaVersion !== 1) fail(`build-record-${arch}.json schemaVersion must be 1`)
  if (record.arch !== arch) fail(`build-record-${arch}.json architecture mismatch`)
  if (record.tag !== tag) fail(`build-record-${arch}.json tag mismatch`)
  if (!STABLE_VERSION_PATTERN.test(record.version) || tag !== `v${record.version}`) {
    fail(`build-record-${arch}.json version mismatch`)
  }
  if (!SOURCE_SHA_PATTERN.test(record.sourceSha)) {
    fail(`build-record-${arch}.json sourceSha is invalid`)
  }
  if (!SOURCE_SHA_PATTERN.test(record.releaseWorkflowSha)) {
    fail(`build-record-${arch}.json releaseWorkflowSha is invalid`)
  }
  if (
    !(typeof record.workflowRunId === 'string' || typeof record.workflowRunId === 'number') ||
    String(record.workflowRunId).length === 0
  ) {
    fail(`build-record-${arch}.json workflowRunId is invalid`)
  }
}

async function resolveArchitectureAssets(assetsDir, arch, checksums) {
  const result = {}
  for (const kind of ASSET_KINDS) {
    const names = [...checksums.keys()].filter((name) => name.toLowerCase().endsWith(`.${kind}`))
    if (names.length !== 1) {
      fail(`${arch} must contain exactly one .${kind} asset`)
    }
    const name = names[0]
    const path = resolve(assetsDir, name)
    let stats
    try {
      stats = lstatSync(path)
    } catch {
      fail(`${arch} asset is missing: ${name}`)
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail(`${arch} asset is not a regular file: ${name}`)
    }
    if (stats.size <= 0 || stats.size > MAX_ASSET_BYTES) {
      fail(`${arch} asset size is invalid: ${name}`)
    }
    const actualHash = await hashFile(path)
    const expectedHash = checksums.get(name)
    if (!SHA256_PATTERN.test(expectedHash) || actualHash !== expectedHash) {
      fail(`${arch} asset checksum mismatch: ${name}`)
    }
    result[kind] = { name, size: stats.size, sha256: actualHash }
  }
  if (checksums.size !== ASSET_KINDS.length) {
    fail(`checksums-${arch}.txt must contain only one DMG`)
  }
  return result
}

export function validateUpdateManifest(manifest) {
  assertExactKeys(
    manifest,
    ['schemaVersion', 'channel', 'tag', 'version', 'sourceSha', 'minimumSystemVersion', 'assets'],
    'update-manifest.json',
  )
  if (manifest.schemaVersion !== 3) fail('Manifest schemaVersion must be 3')
  if (manifest.channel !== 'stable') fail('OSS Manifest channel must be stable')
  if (!STABLE_VERSION_PATTERN.test(manifest.version)) {
    fail('Stable Manifest version must be a stable semantic version')
  }
  if (manifest.tag !== `v${manifest.version}`) fail('Manifest tag and version mismatch')
  if (!SOURCE_SHA_PATTERN.test(manifest.sourceSha)) fail('Manifest sourceSha is invalid')
  if (!SYSTEM_VERSION_PATTERN.test(manifest.minimumSystemVersion)) {
    fail('Manifest minimumSystemVersion is invalid')
  }
  assertExactKeys(manifest.assets, [ARCHITECTURE], 'Manifest assets')

  const names = new Set()
  const architectureAssets = manifest.assets[ARCHITECTURE]
  assertExactKeys(architectureAssets, ASSET_KINDS, `Manifest assets.${ARCHITECTURE}`)
  for (const kind of ASSET_KINDS) {
    const asset = architectureAssets[kind]
    assertExactKeys(asset, ['name', 'size', 'sha256'], `Manifest ${ARCHITECTURE}.${kind}`)
    if (
      typeof asset.name !== 'string' ||
      !SAFE_ASSET_NAME_PATTERN.test(asset.name) ||
      asset.name !== basename(asset.name) ||
      !asset.name.toLowerCase().endsWith(`.${kind}`)
    ) {
      fail(`Manifest ${ARCHITECTURE}.${kind} asset name is invalid`)
    }
    if (names.has(asset.name)) fail('Manifest asset names must be unique')
    names.add(asset.name)
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) {
      fail(`Manifest ${ARCHITECTURE}.${kind} asset size is invalid`)
    }
    if (!SHA256_PATTERN.test(asset.sha256)) {
      fail(`Manifest ${ARCHITECTURE}.${kind} SHA-256 is invalid`)
    }
  }
  return manifest
}

export async function generateUpdateManifest({
  assetsDir,
  tag,
  minimumSystemVersion = '13.0',
  expectedReleaseWorkflowSha,
  expectedWorkflowRunId,
}) {
  if (!new RegExp(`^v${STABLE_VERSION_SOURCE}$`).test(tag)) {
    fail('Release tag must be a stable vX.Y.Z tag')
  }
  if (!SYSTEM_VERSION_PATTERN.test(minimumSystemVersion)) {
    fail('minimumSystemVersion is invalid')
  }

  const record = readJson(
    resolve(assetsDir, `build-record-${ARCHITECTURE}.json`),
    `build-record-${ARCHITECTURE}.json`,
  )
  validateBuildRecord(record, ARCHITECTURE, tag)
  const checksums = parseChecksums(
    resolve(assetsDir, `checksums-${ARCHITECTURE}.txt`),
    ARCHITECTURE,
  )
  const assets = {
    [ARCHITECTURE]: await resolveArchitectureAssets(assetsDir, ARCHITECTURE, checksums),
  }
  if (
    expectedReleaseWorkflowSha &&
    record.releaseWorkflowSha !== expectedReleaseWorkflowSha
  ) {
    fail('Build record does not belong to the current release workflow commit')
  }
  if (expectedWorkflowRunId && String(record.workflowRunId) !== expectedWorkflowRunId) {
    fail('Build record does not belong to the current workflow run')
  }

  return validateUpdateManifest({
    schemaVersion: 3,
    channel: 'stable',
    tag,
    version: record.version,
    sourceSha: record.sourceSha,
    minimumSystemVersion,
    assets,
  })
}

export async function verifyUpdateManifestDirectory({
  assetsDir,
  manifest,
  expectedTag,
  expectedReleaseWorkflowSha,
  expectedWorkflowRunId,
}) {
  validateUpdateManifest(manifest)
  if (expectedTag && manifest.tag !== expectedTag) {
    fail('Manifest does not match the expected Release tag')
  }
  const rebuilt = await generateUpdateManifest({
    assetsDir,
    tag: manifest.tag,
    minimumSystemVersion: manifest.minimumSystemVersion,
    expectedReleaseWorkflowSha,
    expectedWorkflowRunId,
  })
  if (!isDeepStrictEqual(manifest, rebuilt)) {
    fail('Manifest does not match the release assets and build records')
  }
  return rebuilt
}
