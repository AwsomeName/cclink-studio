import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  updateArchitectureSchema,
  updateManifestSchema,
  type UpdateArchitecture,
  type UpdateManifest,
  type UpdateSnapshot,
} from '../../shared/update'
import type { ResolvedUpdateAsset, ResolvedUpdateRelease } from './update-provider'
import { compareStableVersions } from './version'

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

const verifiedUpdateRecordSchema = z
  .object({
    schemaVersion: z.literal(3),
    manifest: updateManifestSchema,
    manifestDigest: sha256Schema,
    architecture: updateArchitectureSchema,
    publishedAt: z.string().datetime({ offset: true }),
    releaseNotes: z.string().max(100_000),
    prerelease: z.boolean(),
    asset: z
      .object({
        name: z.string().min(1).max(255),
        size: z.number().int().positive(),
        sha256: sha256Schema,
      })
      .strict(),
    verifiedAt: z.string().datetime({ offset: true }),
  })
  .strict()

type VerifiedUpdateRecord = z.infer<typeof verifiedUpdateRecordSchema>

export interface UpdateDownloadTarget {
  directory: string
  finalPath: string
  partialPath: string
}

export interface RestoredVerifiedUpdate {
  filePath: string
  releaseSummary: NonNullable<UpdateSnapshot['availableRelease']>
  record: VerifiedUpdateRecord
}

export interface UpdateCacheOptions {
  cacheRoot: string
  currentVersion: string
  architecture: UpdateArchitecture
  systemVersion: string
  track: 'stable' | 'beta'
}

export class UpdateCache {
  constructor(private readonly options: UpdateCacheOptions) {}

  setTrack(track: 'stable' | 'beta'): void {
    this.options.track = track
  }

  async start(): Promise<void> {
    await fs.mkdir(this.options.cacheRoot, { recursive: true, mode: 0o700 })
    await this.cleanupPartialDownloads()
  }

  createDownloadTarget(
    release: ResolvedUpdateRelease,
    asset: ResolvedUpdateAsset,
  ): UpdateDownloadTarget {
    const digest = digestManifest(release.manifest)
    const directory = join(
      this.options.cacheRoot,
      `${release.manifest.version}-${release.architecture}-${digest.slice(0, 12)}`,
    )
    const finalPath = join(directory, basename(asset.name))
    return {
      directory,
      finalPath,
      partialPath: `${finalPath}.part`,
    }
  }

  async commitVerified(
    release: ResolvedUpdateRelease,
    asset: ResolvedUpdateAsset,
    filePath: string,
  ): Promise<RestoredVerifiedUpdate> {
    const record = verifiedUpdateRecordSchema.parse({
      schemaVersion: 3,
      manifest: release.manifest,
      manifestDigest: digestManifest(release.manifest),
      architecture: release.architecture,
      publishedAt: release.publishedAt,
      releaseNotes: release.releaseNotes,
      prerelease: release.prerelease,
      asset: { name: asset.name, size: asset.size, sha256: asset.sha256 },
      verifiedAt: new Date().toISOString(),
    })
    const recordPath = join(dirname(filePath), 'verified.json')
    const temporaryRecordPath = `${recordPath}.part`
    await fs.writeFile(temporaryRecordPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    })
    await fs.rename(temporaryRecordPath, recordPath)
    return {
      filePath,
      releaseSummary: summarizeRecord(record),
      record,
    }
  }

  async restore(): Promise<RestoredVerifiedUpdate | null> {
    const entries = await fs.readdir(this.options.cacheRoot, { withFileTypes: true })
    const candidates: Array<RestoredVerifiedUpdate & { directory: string }> = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const directory = join(this.options.cacheRoot, entry.name)
      try {
        const candidate = await this.verifyDirectory(directory)
        candidates.push({ ...candidate, directory })
      } catch {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      }
    }

    candidates.sort((left, right) => {
      const versionOrder = compareStableVersions(
        right.record.manifest.version,
        left.record.manifest.version,
      )
      return versionOrder || right.record.verifiedAt.localeCompare(left.record.verifiedAt)
    })
    const selected = candidates[0] ?? null
    await Promise.all(
      candidates
        .slice(1)
        .map((candidate) =>
          fs.rm(candidate.directory, { recursive: true, force: true }).catch(() => undefined),
        ),
    )
    if (!selected) return null
    const { directory: _directory, ...restored } = selected
    return restored
  }

  async revalidate(candidate: RestoredVerifiedUpdate): Promise<RestoredVerifiedUpdate> {
    const directory = dirname(candidate.filePath)
    this.assertCacheDirectory(directory)
    try {
      const verified = await this.verifyDirectory(directory)
      if (
        verified.filePath !== candidate.filePath ||
        verified.record.manifestDigest !== candidate.record.manifestDigest
      ) {
        throw new Error('Cached update handle no longer matches the verified record')
      }
      return verified
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async invalidate(candidate: RestoredVerifiedUpdate): Promise<void> {
    const directory = dirname(candidate.filePath)
    this.assertCacheDirectory(directory)
    await fs.rm(directory, { recursive: true, force: true })
  }

  private async verifyDirectory(directory: string): Promise<RestoredVerifiedUpdate> {
    const rawRecord = await fs.readFile(join(directory, 'verified.json'), 'utf8')
    const record = verifiedUpdateRecordSchema.parse(JSON.parse(rawRecord))
    if (
      record.architecture !== this.options.architecture ||
      record.manifestDigest !== digestManifest(record.manifest) ||
      compareStableVersions(record.manifest.version, this.options.currentVersion) <= 0 ||
      (this.options.track === 'stable' && record.prerelease) ||
      compareStableVersions(
        normalizeSystemVersion(this.options.systemVersion),
        normalizeSystemVersion(record.manifest.minimumSystemVersion),
      ) < 0
    ) {
      throw new Error('Cached update is no longer applicable')
    }

    const expectedAsset = record.manifest.assets[record.architecture].dmg
    if (
      record.asset.name !== expectedAsset.name ||
      record.asset.size !== expectedAsset.size ||
      record.asset.sha256 !== expectedAsset.sha256
    ) {
      throw new Error('Cached update metadata does not match its manifest')
    }

    const filePath = join(directory, basename(record.asset.name))
    const stats = await fs.lstat(filePath)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== record.asset.size) {
      throw new Error('Cached update asset is invalid')
    }
    if ((await hashFile(filePath)) !== record.asset.sha256) {
      throw new Error('Cached update checksum does not match')
    }
    return {
      filePath,
      releaseSummary: summarizeRecord(record),
      record,
    }
  }

  private async cleanupPartialDownloads(): Promise<void> {
    const entries = await fs.readdir(this.options.cacheRoot, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const directory = join(this.options.cacheRoot, entry.name)
          const children = await fs.readdir(directory).catch(() => [])
          await Promise.all(
            children
              .filter((name) => name.endsWith('.part'))
              .map((name) => fs.rm(join(directory, name), { force: true })),
          )
        }),
    )
  }

  private assertCacheDirectory(directory: string): void {
    const cacheRoot = resolve(this.options.cacheRoot)
    const candidate = resolve(directory)
    const childPath = relative(cacheRoot, candidate)
    if (!childPath || childPath.startsWith('..') || childPath.includes('/')) {
      throw new Error('Update cache handle is outside its private release directory')
    }
  }
}

export function digestManifest(manifest: UpdateManifest): string {
  return createHash('sha256').update(stableStringify(manifest)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function summarizeRecord(
  record: VerifiedUpdateRecord,
): NonNullable<UpdateSnapshot['availableRelease']> {
  return {
    tag: record.manifest.tag,
    version: record.manifest.version,
    channel: record.manifest.channel,
    architecture: record.architecture,
    minimumSystemVersion: record.manifest.minimumSystemVersion,
    publishedAt: record.publishedAt,
    releaseNotes: record.releaseNotes,
    prerelease: record.prerelease,
    asset: {
      kind: 'dmg',
      name: record.asset.name,
      size: record.asset.size,
    },
  }
}

function normalizeSystemVersion(value: string): string {
  const parts = value.split('.').slice(0, 3)
  while (parts.length < 3) parts.push('0')
  return parts.join('.')
}
