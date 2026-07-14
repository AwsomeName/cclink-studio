import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { LocalIdentity } from '../../shared/ipc/identity'

export interface LocalIdentityFile {
  version: 1
  identity: LocalIdentity
}

export class LocalIdentityService {
  private readonly filePath: string
  private identity: LocalIdentity | null = null

  constructor(filename = 'local-identity.json') {
    this.filePath = join(app.getPath('userData'), filename)
  }

  async ensureIdentity(): Promise<LocalIdentity> {
    if (this.identity) return this.identity

    const loaded = await this.loadIdentity()
    if (loaded) {
      this.identity = loaded
      return loaded
    }

    const now = Date.now()
    const identity: LocalIdentity = {
      localId: `local_${randomUUID()}`,
      deviceId: `device_${randomUUID()}`,
      deviceName: hostname() || 'This Mac',
      createdAt: now,
      updatedAt: now,
      boundCloudUserId: null,
    }
    await this.saveIdentity(identity)
    this.identity = identity
    return identity
  }

  private async loadIdentity(): Promise<LocalIdentity | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<LocalIdentityFile>
      if (!isLocalIdentity(parsed.identity)) return null
      return {
        ...parsed.identity,
        boundCloudUserId: parsed.identity.boundCloudUserId ?? null,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[LocalIdentity] 加载失败，将重新生成:', (error as Error).message)
      }
      return null
    }
  }

  private async saveIdentity(identity: LocalIdentity): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(
      this.filePath,
      JSON.stringify({ version: 1, identity } satisfies LocalIdentityFile, null, 2),
      'utf-8',
    )
  }
}

function isLocalIdentity(value: unknown): value is LocalIdentity {
  if (!value || typeof value !== 'object') return false
  const identity = value as Partial<LocalIdentity>
  return (
    typeof identity.localId === 'string' &&
    identity.localId.startsWith('local_') &&
    typeof identity.deviceId === 'string' &&
    typeof identity.deviceName === 'string' &&
    typeof identity.createdAt === 'number' &&
    typeof identity.updatedAt === 'number'
  )
}
