import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

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
    },
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
})
