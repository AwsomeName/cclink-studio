import { describe, expect, it } from 'vitest'
import {
  parseUpdateInstallPreparation,
  parseUpdateManualInstallerResult,
  parseUpdateSnapshot,
  updateIpc,
  updateSnapshotChangedEventSchema,
} from './update-contract'

function idleSnapshot() {
  return {
    schemaVersion: 1,
    phase: 'idle',
    operationId: null,
    currentVersion: '1.2.3',
    track: 'stable',
    availableRelease: null,
    progress: null,
    lastCheckedAt: null,
    ignoredVersion: null,
    error: null,
  }
}

function availableSnapshot() {
  return {
    ...idleSnapshot(),
    phase: 'available',
    operationId: 'check-1',
    availableRelease: {
      tag: 'v1.2.4',
      version: '1.2.4',
      channel: 'stable',
      architecture: 'arm64',
      minimumSystemVersion: '13.0',
      publishedAt: '2026-08-16T03:25:51.000Z',
      releaseNotes: 'Update notes',
      prerelease: false,
      asset: {
        kind: 'dmg',
        name: 'cclink-studio-1.2.4-arm64.dmg',
        size: 1024,
      },
    },
    lastCheckedAt: '2026-08-16T03:26:00.000Z',
  }
}

describe('update contract', () => {
  it('accepts a bounded idle snapshot', () => {
    expect(parseUpdateSnapshot(idleSnapshot())).toEqual(idleSnapshot())
  })

  it('requires a release summary for active update phases', () => {
    expect(() => parseUpdateSnapshot({ ...idleSnapshot(), phase: 'available' })).toThrow()
  })

  it('requires a stable operation id outside disabled and idle phases', () => {
    expect(() => parseUpdateSnapshot({ ...idleSnapshot(), phase: 'checking' })).toThrow()
  })

  it('allows a retained candidate to carry a structured refresh error', () => {
    const snapshot = {
      ...availableSnapshot(),
      error: {
        code: 'network_offline',
        userMessage: '无法连接更新服务',
        retryable: true,
      },
    }

    expect(parseUpdateSnapshot(snapshot)).toEqual(snapshot)
    expect(() => parseUpdateSnapshot({ ...idleSnapshot(), error: snapshot.error })).toThrow()
  })

  it('does not allow paths, URLs, manifests, or credentials in the public snapshot', () => {
    expect(() =>
      parseUpdateSnapshot({
        ...idleSnapshot(),
        downloadUrl: 'https://example.test/update.dmg',
      }),
    ).toThrow()
  })

  it('requires a short-lived confirmation token for an install preparation', () => {
    expect(() =>
      parseUpdateInstallPreparation({
        ok: true,
        confirmationToken: null,
        impacts: [],
        snapshot: idleSnapshot(),
      }),
    ).toThrow()
    expect(() =>
      parseUpdateInstallPreparation({
        ok: false,
        confirmationToken: 'must-not-exist',
        impacts: [],
        snapshot: idleSnapshot(),
      }),
    ).toThrow()
  })

  it('validates install confirmation input at the IPC boundary', () => {
    expect(updateIpc.installAndRestart.parseArgs([{ confirmationToken: 'confirm-1' }])).toEqual([
      { confirmationToken: 'confirm-1' },
    ])
    expect(() => updateIpc.installAndRestart.parseArgs([{ confirmationToken: '' }])).toThrow()
  })

  it('requires a structured error when opening the manual installer fails', () => {
    expect(() =>
      parseUpdateManualInstallerResult({
        ok: false,
        error: null,
        snapshot: idleSnapshot(),
      }),
    ).toThrow()
    expect(
      parseUpdateManualInstallerResult({
        ok: false,
        error: {
          code: 'install_failed',
          userMessage: 'macOS 未能打开安装包',
          retryable: true,
        },
        snapshot: idleSnapshot(),
      }).error?.code,
    ).toBe('install_failed')
  })

  it('validates snapshot change event payloads', () => {
    expect(updateSnapshotChangedEventSchema.parse({ snapshot: idleSnapshot() })).toEqual({
      snapshot: idleSnapshot(),
    })
    expect(() =>
      updateSnapshotChangedEventSchema.parse({
        snapshot: idleSnapshot(),
        downloadUrl: 'https://example.test/update.dmg',
      }),
    ).toThrow()
  })
})
