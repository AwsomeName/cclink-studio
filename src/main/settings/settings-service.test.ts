import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
      provider: 'anthropic',
      apiFormat: 'anthropic',
      backendType: 'claude-code',
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
    expect(settingsFile).not.toContain('"provider": "openai"')
    const credentialFile = JSON.parse(
      await readFile(join(tempDir, 'credentials/credentials.json'), 'utf-8'),
    )
    expect(credentialFile.records['agent:default'].fields.apiKey).toBe('legacy-agent-secret')
    expect(credentialFile.records['extension:meshy:default'].fields.apiKey).toBe(
      'legacy-meshy-secret',
    )
  })

  it('migrates and rejects unsupported OpenAI Compatible runtime settings', async () => {
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({
        provider: 'openai',
        apiFormat: 'openai',
        backendType: 'http-api',
        apiBaseUrl: 'https://api.openai.com/v1',
        modelName: 'gpt-canary',
      }),
      'utf8',
    )
    const service = createSettingsService()

    await service.loadState()

    expect(service.getAll()).toMatchObject({
      provider: 'anthropic',
      apiFormat: 'anthropic',
      backendType: 'claude-code',
      apiBaseUrl: 'https://api.anthropic.com',
      modelName: 'claude-sonnet-4-6',
    })
    await expect(service.set({ apiFormat: 'openai' })).rejects.toThrow('尚未实现')
    await expect(service.set({ backendType: 'http-api' })).rejects.toThrow('尚未实现')
    await expect(service.set({ provider: 'openai' })).rejects.toThrow('尚未实现')
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

  it('keeps the Codex ACP key separate from the Claude key', async () => {
    const service = createSettingsService()
    await service.loadState()

    await service.setSecret('apiKey', 'claude-secret')
    await service.setSecret('codexApiKey', 'codex-secret')

    expect(service.getAll()).toMatchObject({ apiKey: '', codexApiKey: '' })
    expect(service.getRuntimeSettings()).toMatchObject({
      apiKey: 'claude-secret',
      codexApiKey: 'codex-secret',
    })
    expect(service.getSecretStatus()).toMatchObject({
      apiKeyConfigured: true,
      codexApiKeyConfigured: true,
    })
    const settingsFile = await readFile(join(tempDir, 'settings.json'), 'utf-8')
    expect(settingsFile).not.toContain('claude-secret')
    expect(settingsFile).not.toContain('codex-secret')

    await service.clearSecret('codexApiKey')
    expect(service.getRuntimeSettings()).toMatchObject({
      apiKey: 'claude-secret',
      codexApiKey: '',
    })
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
  it('moves the retired bundled selection to the same managed runtime version', async () => {
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({
        claudeRuntimeSource: 'bundled',
        claudeCodePath: '/should/not/survive',
        componentSetupPageSeenVersion: 1,
      }),
      'utf8',
    )

    const service = createSettingsService()
    await service.loadState()

    expect(service.getAll()).toMatchObject({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
      claudeCodePath: '',
      componentSetupPageSeenVersion: 1,
    })
    expect(JSON.parse(await readFile(join(tempDir, 'settings.json'), 'utf8'))).toMatchObject({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
      claudeCodePath: '',
    })
  })

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

  it('persists a managed version and clears mutually exclusive runtime fields', async () => {
    const service = createSettingsService()
    await service.loadState()
    await service.set({ claudeCodePath: '/opt/homebrew/bin/claude' })

    await service.set({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
    })

    expect(service.getAll()).toMatchObject({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
      claudeCodePath: '',
    })
    const replacementAppService = createSettingsService()
    await replacementAppService.loadState()
    expect(replacementAppService.getAll()).toMatchObject({
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
      claudeCodePath: '',
    })
  })
})

describe('SettingsService component setup onboarding', () => {
  it('keeps a fresh install eligible for the first-run component page', async () => {
    const service = createSettingsService()
    await service.loadState()

    expect(service.getAll().componentSetupPageSeenVersion).toBe(0)
  })

  it('does not treat an existing installation as a fresh install after upgrade', async () => {
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({ updateTrack: 'stable' }),
      'utf8',
    )

    const service = createSettingsService()
    await service.loadState()

    expect(service.getAll().componentSetupPageSeenVersion).toBe(1)
    expect(
      JSON.parse(await readFile(join(tempDir, 'settings.json'), 'utf8'))
        .componentSetupPageSeenVersion,
    ).toBe(1)
  })

  it('preserves the onboarding marker when user settings are reset', async () => {
    const service = createSettingsService()
    await service.loadState()
    await service.set({ componentSetupPageSeenVersion: 1 })

    await service.reset()

    expect(service.getAll().componentSetupPageSeenVersion).toBe(1)
  })
})

describe('SettingsService keybinding persistence', () => {
  it('serializes concurrent setting updates without losing either change', async () => {
    const service = createSettingsService()
    await service.loadState()

    await Promise.all([
      service.set({ editorFontSize: 19 }),
      service.set({
        keybindingOverrides: [
          {
            commandId: 'workbench.find',
            bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
          },
        ],
      }),
    ])

    const persisted = JSON.parse(await readFile(join(tempDir, 'settings.json'), 'utf8'))
    expect(persisted).toMatchObject({
      editorFontSize: 19,
      keybindingOverrides: [
        {
          commandId: 'workbench.find',
          bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
        },
      ],
    })
    expect((await readdir(tempDir)).some((file) => file.includes('.tmp-'))).toBe(false)
  })

  it('clears only keybinding overrides when the shortcuts page restores defaults', async () => {
    const service = createSettingsService()
    await service.loadState()
    await service.set({
      editorFontSize: 21,
      keybindingOverrides: [
        {
          commandId: 'workbench.find',
          bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
        },
      ],
    })

    await service.set({ keybindingOverrides: [] })

    expect(service.getAll()).toMatchObject({ editorFontSize: 21, keybindingOverrides: [] })
  })

  it('returns a defensive copy of nested keybinding state', async () => {
    const service = createSettingsService()
    await service.loadState()
    await service.set({
      keybindingOverrides: [
        {
          commandId: 'workbench.find',
          bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
        },
      ],
    })
    const snapshot = service.getAll()
    snapshot.keybindingOverrides[0].bindings[0].code = 'KeyX'

    expect(service.getAll().keybindingOverrides[0].bindings[0].code).toBe('KeyK')
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
