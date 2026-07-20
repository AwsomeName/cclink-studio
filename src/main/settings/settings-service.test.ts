import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  userDataDir: '',
  encryptionAvailable: true,
}))

vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, ''),
  },
}))

import { SettingsService } from './settings-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-settings-'))
  mockState.userDataDir = tempDir
  mockState.encryptionAvailable = true
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('SettingsService secrets', () => {
  it('migrates legacy plaintext secrets without exposing them to the renderer', async () => {
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({
        provider: 'openai',
        apiKey: 'legacy-agent-secret',
        meshyApiKey: 'legacy-meshy-secret',
      }),
      'utf-8',
    )

    const service = new SettingsService()
    await service.loadState()

    expect(service.getAll()).toMatchObject({
      provider: 'openai',
      apiKey: '',
      meshyApiKey: '',
    })
    expect(service.getRuntimeSettings()).toMatchObject({
      apiKey: 'legacy-agent-secret',
      meshyApiKey: 'legacy-meshy-secret',
    })
    expect(service.getSecretStatus()).toMatchObject({
      apiKeyConfigured: true,
      meshyApiKeyConfigured: true,
      migrationBlocked: false,
    })

    const settingsFile = await readFile(join(tempDir, 'settings.json'), 'utf-8')
    expect(settingsFile).not.toContain('apiKey')
    expect(settingsFile).not.toContain('meshyApiKey')
    expect(settingsFile).not.toContain('legacy-agent-secret')
    const credentialFile = await readFile(join(tempDir, 'settings/secrets.enc'), 'utf-8')
    expect(credentialFile).not.toContain('legacy-agent-secret')
    expect(credentialFile).not.toContain('legacy-meshy-secret')
  })

  it('updates encrypted secrets only through the dedicated API', async () => {
    const service = new SettingsService()
    await service.loadState()

    await expect(service.set({ apiKey: 'not-allowed' })).rejects.toThrow(
      '敏感设置必须通过专用凭证接口更新',
    )
    await service.setSecret('apiKey', 'new-agent-secret')

    expect(service.getAll().apiKey).toBe('')
    expect(service.getRuntimeSettings().apiKey).toBe('new-agent-secret')
    expect(service.getSecretStatus().apiKeyConfigured).toBe(true)
    expect(await readFile(join(tempDir, 'settings.json'), 'utf-8')).not.toContain('apiKey')

    await service.clearSecret('apiKey')
    expect(service.getRuntimeSettings().apiKey).toBe('')
    expect(service.getSecretStatus().apiKeyConfigured).toBe(false)
  })

  it('preserves legacy plaintext when encryption is unavailable', async () => {
    const legacySettings = JSON.stringify(
      { provider: 'anthropic', apiKey: 'must-not-be-lost' },
      null,
      2,
    )
    await writeFile(join(tempDir, 'settings.json'), legacySettings, 'utf-8')
    mockState.encryptionAvailable = false

    const service = new SettingsService()
    await service.loadState()

    expect(service.getAll().apiKey).toBe('')
    expect(service.getRuntimeSettings().apiKey).toBe('must-not-be-lost')
    expect(service.getSecretStatus()).toMatchObject({
      apiKeyConfigured: true,
      encryptionAvailable: false,
      migrationBlocked: true,
    })
    await expect(service.set({ modelName: 'blocked-write' })).rejects.toThrow(
      '旧版明文凭证尚未迁移',
    )
    expect(service.getAll().modelName).not.toBe('blocked-write')
    expect(await readFile(join(tempDir, 'settings.json'), 'utf-8')).toBe(legacySettings)
  })
})
