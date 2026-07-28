import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir },
  clipboard: { writeText: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
}))

import { SettingsService } from './settings-service'
import { CredentialService } from '../credentials/credential-service'
import { PlaintextCredentialStore } from '../credentials/plaintext-credential-store'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-settings-'))
  mockState.userDataDir = tempDir
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

    const service = createSettingsService()
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
    const credentialFile = JSON.parse(
      await readFile(join(tempDir, 'credentials/credentials.json'), 'utf-8'),
    )
    expect(credentialFile.records['agent:default'].fields.apiKey).toBe('legacy-agent-secret')
    expect(credentialFile.records['extension:meshy:default'].fields.apiKey).toBe(
      'legacy-meshy-secret',
    )
  })

  it('updates local credentials only through the dedicated API', async () => {
    const service = createSettingsService()
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

  it('preserves legacy plaintext when the credential file is damaged', async () => {
    const legacySettings = JSON.stringify(
      { provider: 'anthropic', apiKey: 'must-not-be-lost' },
      null,
      2,
    )
    await writeFile(join(tempDir, 'settings.json'), legacySettings, 'utf-8')
    await mkdir(join(tempDir, 'credentials'), { recursive: true })
    await writeFile(join(tempDir, 'credentials/credentials.json'), '{broken', 'utf-8')

    const service = createSettingsService()
    await service.loadState()

    expect(service.getAll().apiKey).toBe('')
    expect(service.getRuntimeSettings().apiKey).toBe('')
    expect(service.getSecretStatus()).toMatchObject({
      apiKeyConfigured: false,
      storageAvailable: false,
      migrationBlocked: true,
    })
    await expect(service.set({ modelName: 'blocked-write' })).rejects.toThrow(
      '旧版明文凭证尚未迁移',
    )
    expect(service.getAll().modelName).not.toBe('blocked-write')
    expect(await readFile(join(tempDir, 'settings.json'), 'utf-8')).toBe(legacySettings)
  })
})

describe('SettingsService Claude runtime migration', () => {
  it('migrates a legacy configured path to the custom runtime source', async () => {
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({ claudeCodePath: '/usr/local/bin/claude' }),
      'utf8',
    )

    const service = createSettingsService()
    await service.loadState()

    expect(service.getAll()).toMatchObject({
      claudeRuntimeSource: 'custom',
      claudeCodePath: '/usr/local/bin/claude',
    })
    expect(JSON.parse(await readFile(join(tempDir, 'settings.json'), 'utf8'))).toMatchObject({
      claudeRuntimeSource: 'custom',
      claudeCodePath: '/usr/local/bin/claude',
    })
  })

  it('normalizes path-only updates and source changes as one setting transaction', async () => {
    const service = createSettingsService()
    await service.loadState()

    await service.set({ claudeCodePath: '/opt/homebrew/bin/claude' })
    expect(service.getAll()).toMatchObject({
      claudeRuntimeSource: 'custom',
      claudeCodePath: '/opt/homebrew/bin/claude',
    })

    await service.set({ claudeRuntimeSource: 'system' })
    expect(service.getAll()).toMatchObject({
      claudeRuntimeSource: 'system',
      claudeCodePath: '',
    })
  })
})

function createSettingsService(): SettingsService {
  return new SettingsService(
    new CredentialService(
      new PlaintextCredentialStore(join(tempDir, 'credentials/credentials.json')),
      { userDataPath: tempDir },
    ),
  )
}
