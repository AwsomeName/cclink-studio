import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UpdateSnapshot } from '@shared/update'

const { registerFloatingSurface, updateState } = vi.hoisted(() => ({
  registerFloatingSurface: vi.fn(() => vi.fn()),
  updateState: {
    snapshot: {
      schemaVersion: 1,
      phase: 'idle',
      operationId: null,
      currentVersion: '0.1.26',
      track: 'stable',
      availableRelease: null,
      progress: null,
      lastCheckedAt: null,
      ignoredVersion: null,
      error: null,
    } as UpdateSnapshot,
    panelOpen: false,
    closePanel: vi.fn(),
    check: vi.fn(),
    startDownload: vi.fn(),
    startDownloadInBackground: vi.fn(),
    cancelDownload: vi.fn(),
    defer: vi.fn(),
    ignoreVersion: vi.fn(),
    openManualInstaller: vi.fn(),
    manualInstallerBusy: false,
    manualInstallerError: null,
  },
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => effect(),
}))

vi.mock('../common/floating-surface-registry', () => ({ registerFloatingSurface }))

vi.mock('../../stores/update-store', () => ({
  useUpdateStore: (selector: (state: typeof updateState) => unknown) => selector(updateState),
}))

import { UpdatePanel } from './UpdatePanel'

vi.stubGlobal('React', React)

describe('UpdatePanel native browser occlusion', () => {
  beforeEach(() => {
    registerFloatingSurface.mockClear()
    updateState.panelOpen = false
    updateState.snapshot = {
      schemaVersion: 1,
      phase: 'idle',
      operationId: null,
      currentVersion: '0.1.26',
      track: 'stable',
      availableRelease: null,
      progress: null,
      lastCheckedAt: null,
      ignoredVersion: null,
      error: null,
    }
  })

  it('does not suspend the native browser view while closed', () => {
    expect(UpdatePanel()).toBeNull()
    expect(registerFloatingSurface).not.toHaveBeenCalled()
  })

  it('registers as a floating surface while open so the native browser view is hidden', () => {
    updateState.panelOpen = true

    expect(UpdatePanel()).not.toBeNull()
    expect(registerFloatingSurface).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit recheck and shows the last successful check for a candidate', () => {
    updateState.panelOpen = true
    updateState.snapshot = availableSnapshot()

    const markup = renderToStaticMarkup(React.createElement(UpdatePanel))

    expect(markup).toContain('重新检查')
    expect(markup).toContain('上次成功检查')
    expect(markup).toContain('v0.1.38')
  })

  it('keeps the candidate visible when a recheck fails', () => {
    updateState.panelOpen = true
    updateState.snapshot = {
      ...availableSnapshot(),
      error: {
        code: 'network_offline',
        userMessage: '无法连接更新服务',
        retryable: true,
      },
    }

    const markup = renderToStaticMarkup(React.createElement(UpdatePanel))

    expect(markup).toContain('未能刷新最新版本')
    expect(markup).toContain('已保留 v0.1.38')
    expect(markup).toContain('后台下载')
  })
})

function availableSnapshot(): UpdateSnapshot {
  return {
    schemaVersion: 1,
    phase: 'available',
    operationId: 'update-operation',
    currentVersion: '0.1.37',
    track: 'stable',
    availableRelease: {
      tag: 'v0.1.38',
      version: '0.1.38',
      channel: 'stable',
      architecture: 'arm64',
      minimumSystemVersion: '13.0',
      publishedAt: '2026-08-16T01:06:58.000Z',
      releaseNotes: 'Update notes',
      prerelease: false,
      asset: {
        kind: 'dmg',
        name: 'cclink-studio-0.1.38-arm64.dmg',
        size: 143_314_001,
      },
    },
    progress: null,
    lastCheckedAt: '2026-08-16T01:07:30.000Z',
    ignoredVersion: null,
    error: null,
  }
}
