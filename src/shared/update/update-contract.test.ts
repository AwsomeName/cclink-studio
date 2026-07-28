import { describe, expect, it } from 'vitest'
import {
  parseUpdateInstallPreparation,
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
    availableRelease: null,
    progress: null,
    lastCheckedAt: null,
    ignoredVersion: null,
    error: null,
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
