import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => mockPaths.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, ''),
  },
}))

import { SettingsCredentialStore } from './settings-credential-store'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-settings-secret-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('SettingsCredentialStore', () => {
  it('encrypts settings secrets and never persists plaintext', async () => {
    const store = new SettingsCredentialStore()
    await store.setSecrets({ apiKey: 'agent-secret', meshyApiKey: 'meshy-secret' })

    const raw = await readFile(join(tempDir, 'settings/secrets.enc'), 'utf-8')
    expect(raw).not.toContain('agent-secret')
    expect(raw).not.toContain('meshy-secret')
    await expect(new SettingsCredentialStore().getAll()).resolves.toEqual({
      apiKey: 'agent-secret',
      meshyApiKey: 'meshy-secret',
    })
  })

  it('refuses plaintext fallback when encryption is unavailable', async () => {
    const store = new SettingsCredentialStore('settings/secrets.enc', {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    })

    await expect(store.setSecret('apiKey', 'agent-secret')).rejects.toMatchObject({
      code: 'ENCRYPTION_UNAVAILABLE',
    })
  })

  it('rejects the insecure Linux basic_text backend', async () => {
    const store = new SettingsCredentialStore('settings/secrets.enc', {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: () => Buffer.from('not-secure'),
      decryptString: () => '',
    })

    await expect(store.setSecret('apiKey', 'agent-secret')).rejects.toMatchObject({
      code: 'ENCRYPTION_UNAVAILABLE',
    })
  })

  it('serializes concurrent secret updates without dropping another key', async () => {
    const store = new SettingsCredentialStore()

    await Promise.all([
      store.setSecret('apiKey', 'agent-secret'),
      store.setSecret('meshyApiKey', 'meshy-secret'),
    ])

    await expect(store.getAll()).resolves.toEqual({
      apiKey: 'agent-secret',
      meshyApiKey: 'meshy-secret',
    })
  })
})
