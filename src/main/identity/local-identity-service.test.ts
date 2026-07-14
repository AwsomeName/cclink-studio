import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockPaths.userDataDir,
  },
}))

import { LocalIdentityService } from './local-identity-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-local-identity-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('LocalIdentityService', () => {
  it('creates and persists a local identity on first launch', async () => {
    const service = new LocalIdentityService()

    const identity = await service.ensureIdentity()

    expect(identity.localId).toMatch(/^local_/)
    expect(identity.deviceId).toMatch(/^device_/)
    expect(identity.deviceName.length).toBeGreaterThan(0)
    expect(identity.boundCloudUserId).toBeNull()

    const raw = await readFile(join(tempDir, 'local-identity.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version: number; identity: unknown }
    expect(parsed.version).toBe(1)
    expect(parsed.identity).toEqual(identity)
  })

  it('reuses an existing identity across service instances', async () => {
    const first = new LocalIdentityService()
    const created = await first.ensureIdentity()

    const second = new LocalIdentityService()
    const loaded = await second.ensureIdentity()

    expect(loaded).toEqual(created)
  })

  it('regenerates identity when the stored file is corrupted', async () => {
    await writeFile(join(tempDir, 'local-identity.json'), '{bad json', 'utf-8')

    const service = new LocalIdentityService()
    const identity = await service.ensureIdentity()

    expect(identity.localId).toMatch(/^local_/)
    expect(identity.deviceId).toMatch(/^device_/)
  })
})
