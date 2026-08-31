import { describe, expect, it } from 'vitest'
import {
  parseSettingsKey,
  parseSettingsSecretKey,
  parseSettingsUpdate,
} from './settings-ipc-schema'

describe('settings IPC runtime schema', () => {
  it('accepts bounded public settings updates', () => {
    expect(
      parseSettingsUpdate({
        permissionMode: 'strict',
        showHiddenFiles: true,
        recentWorkspacePaths: ['/workspace'],
      }),
    ).toEqual({
      permissionMode: 'strict',
      showHiddenFiles: true,
      recentWorkspacePaths: ['/workspace'],
    })
  })

  it('rejects secrets, unknown fields and invalid numeric values', () => {
    expect(() => parseSettingsUpdate({ apiKey: 'must-use-secret-ipc' })).toThrow()
    expect(() => parseSettingsUpdate({ unknownSetting: true })).toThrow()
    expect(() => parseSettingsUpdate({ uiFontSize: 14 })).toThrow()
    expect(() => parseSettingsUpdate({ apiFormat: 'openai' })).toThrow()
    expect(() => parseSettingsUpdate({ backendType: 'http-api' })).toThrow()
    expect(() => parseSettingsUpdate({ provider: 'openai' })).toThrow()
  })

  it('limits secret and reset keys to the declared contract', () => {
    expect(parseSettingsSecretKey('apiKey')).toBe('apiKey')
    expect(parseSettingsKey('meshyApiKey')).toBe('meshyApiKey')
    expect(() => parseSettingsSecretKey('gitToken')).toThrow()
    expect(() => parseSettingsKey('__proto__')).toThrow()
  })
})
