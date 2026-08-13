import type { UpdateCommandResult, UpdateSnapshot } from '@shared/update'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdateStore } from './update-store'

const release = {
  tag: 'v0.1.29',
  version: '0.1.29',
  channel: 'stable' as const,
  architecture: 'arm64' as const,
  minimumSystemVersion: '13.0',
  publishedAt: '2026-08-13T07:01:51.000Z',
  releaseNotes: '',
  prerelease: false,
  asset: {
    kind: 'dmg' as const,
    name: 'cclink-studio-0.1.29-arm64.dmg',
    size: 212_383_949,
  },
}

const availableSnapshot: UpdateSnapshot = {
  schemaVersion: 1,
  phase: 'available',
  operationId: 'update-operation',
  currentVersion: '0.1.28',
  track: 'stable',
  availableRelease: release,
  progress: null,
  lastCheckedAt: '2026-08-13T07:02:00.000Z',
  ignoredVersion: null,
  error: null,
}

const downloadingSnapshot: UpdateSnapshot = {
  ...availableSnapshot,
  phase: 'downloading',
  progress: {
    fraction: 0,
    downloadedBytes: 0,
    totalBytes: release.asset.size,
    bytesPerSecond: 0,
  },
}

describe('update store background download', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      snapshot: availableSnapshot,
      panelOpen: true,
      hydrated: true,
      manualInstallerBusy: false,
      manualInstallerError: null,
    })
  })

  it('closes the modal immediately while the main process download continues', async () => {
    let finishDownload!: (result: UpdateCommandResult) => void
    const startDownload = vi.fn(
      () =>
        new Promise<UpdateCommandResult>((resolve) => {
          finishDownload = resolve
        }),
    )
    vi.stubGlobal('window', { cclinkStudio: { update: { startDownload } } })

    const pending = useUpdateStore.getState().startDownloadInBackground()

    expect(startDownload).toHaveBeenCalledTimes(1)
    expect(useUpdateStore.getState().panelOpen).toBe(false)

    finishDownload({ ok: true, snapshot: downloadingSnapshot })
    await pending
    expect(useUpdateStore.getState().snapshot).toEqual(downloadingSnapshot)
  })
})
