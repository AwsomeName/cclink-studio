import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))
const copyText = vi.hoisted(() => vi.fn())
const openPath = vi.hoisted(() => vi.fn(async () => ''))

vi.mock('electron', () => ({
  app: { getPath: () => mockPaths.userDataDir },
  clipboard: { writeText: copyText },
  shell: { openPath },
}))

import { CredentialService } from './credential-service'
import { PlaintextCredentialStore } from './plaintext-credential-store'

let tempDir = ''
let credentialFile = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-credentials-'))
  credentialFile = join(tempDir, 'credentials/credentials.json')
  mockPaths.userDataDir = tempDir
  copyText.mockClear()
  openPath.mockClear()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('CredentialService', () => {
  it('persists a visible plaintext file and reloads all consumers from one store', async () => {
    const service = createService()
    await service.load()
    await Promise.all([
      service.setCredential({
        id: 'agent:default',
        kind: 'api-key',
        fields: { apiKey: 'agent-secret' },
      }),
      service.setCredential({
        id: 'git:github',
        kind: 'token',
        fields: { token: 'github-secret' },
      }),
    ])

    const raw = await readFile(credentialFile, 'utf-8')
    expect(raw).toContain('agent-secret')
    expect(raw).toContain('github-secret')
    expect((await stat(credentialFile)).mode & 0o777).toBe(0o600)

    const reloaded = createService()
    await reloaded.load()
    expect(reloaded.resolveCredential('agent:default')).toEqual({ apiKey: 'agent-secret' })
    expect(reloaded.resolveCredential('git:github')).toEqual({ token: 'github-secret' })
    expect(reloaded.listMetadata()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent:default',
          fieldNames: ['apiKey'],
          consumers: ['Agent'],
        }),
        expect.objectContaining({
          id: 'git:github',
          fieldNames: ['token'],
          consumers: ['Git 备份'],
        }),
      ]),
    )
  })

  it('returns and copies only the explicitly requested field', async () => {
    const service = createService()
    await service.load()
    await service.setCredential({
      id: 'data-source:source-1',
      kind: 'basic',
      fields: { username: 'reader', password: 'private-password' },
    })

    expect(service.revealField('data-source:source-1', 'username')).toBe('reader')
    service.copyField('data-source:source-1', 'password')
    expect(copyText).toHaveBeenCalledWith('private-password')
    expect(JSON.stringify(service.listMetadata())).not.toContain('private-password')
  })

  it('detects external changes and refuses to overwrite them until reload', async () => {
    const service = createService()
    await service.load()
    await service.setCredential({
      id: 'agent:default',
      kind: 'api-key',
      fields: { apiKey: 'first-value' },
    })
    const externalState = {
      schemaVersion: 1,
      records: {
        'agent:default': {
          kind: 'api-key',
          fields: { apiKey: 'external-value' },
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      },
    }
    await writeFile(credentialFile, `${JSON.stringify(externalState, null, 2)}\n`, 'utf-8')

    await expect(
      service.setCredential({
        id: 'git:github',
        kind: 'token',
        fields: { token: 'must-not-overwrite' },
      }),
    ).rejects.toThrow('外部修改')
    expect(service.getStatus().status).toBe('conflict')
    expect(await readFile(credentialFile, 'utf-8')).toContain('external-value')
    expect(await readFile(credentialFile, 'utf-8')).not.toContain('must-not-overwrite')

    await service.reload()
    expect(service.getStatus().status).toBe('ready')
    expect(service.resolveCredential('agent:default')?.apiKey).toBe('external-value')
  })

  it('keeps a damaged file untouched and degrades instead of treating it as empty', async () => {
    await mkdir(join(tempDir, 'credentials'), { recursive: true })
    await writeFile(credentialFile, '{not-json', 'utf-8')
    const service = createService()

    await service.load()

    expect(service.getStatus()).toMatchObject({ status: 'degraded', configuredCount: 0 })
    await expect(
      service.setCredential({
        id: 'agent:default',
        kind: 'api-key',
        fields: { apiKey: 'must-not-write' },
      }),
    ).rejects.toThrow('有效 JSON')
    expect(await readFile(credentialFile, 'utf-8')).toBe('{not-json')
  })

  it('reports legacy encrypted files without reading or migrating them', async () => {
    await mkdir(join(tempDir, 'settings'), { recursive: true })
    await writeFile(join(tempDir, 'settings/secrets.enc'), 'opaque-data', 'utf-8')
    const service = createService()

    await service.load()

    expect(service.getStatus()).toMatchObject({
      status: 'ready',
      legacyEncryptedFiles: [join(tempDir, 'settings/secrets.enc')],
    })
    expect(service.getStatus().message).toContain('重新输入')

    await service.removeLegacyFiles()
    expect(service.getStatus().legacyEncryptedFiles).toEqual([])
    await expect(readFile(join(tempDir, 'settings/secrets.enc'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})

function createService(): CredentialService {
  return new CredentialService(new PlaintextCredentialStore(credentialFile), {
    copyText,
    openPath,
    userDataPath: tempDir,
    now: () => new Date('2026-07-28T00:00:00.000Z'),
  })
}
