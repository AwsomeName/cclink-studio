import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UpdateSnapshot } from '@shared/update'

const { useEscapeDismiss, useFloatingSurfaceRegistration, updateState } = vi.hoisted(() => ({
  useEscapeDismiss: vi.fn(),
  useFloatingSurfaceRegistration: vi.fn(),
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
    installPreparation: null as import('@shared/update').UpdateInstallPreparation | null,
    installBusy: false,
    prepareInstall: vi.fn(),
    confirmInstall: vi.fn(),
  },
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => effect(),
}))

vi.mock('../common/dismissable-layer', () => ({ useEscapeDismiss }))
vi.mock('../common/floating-surface-registry', () => ({ useFloatingSurfaceRegistration }))

vi.mock('../../stores/update-store', () => ({
  useUpdateStore: (selector: (state: typeof updateState) => unknown) => selector(updateState),
}))

import { UpdatePanel } from './UpdatePanel'

vi.stubGlobal('React', React)

describe('UpdatePanel native browser occlusion', () => {
  beforeEach(() => {
    useEscapeDismiss.mockClear()
    useFloatingSurfaceRegistration.mockClear()
    updateState.check.mockClear()
    updateState.startDownload.mockClear()
    updateState.panelOpen = false
    updateState.installPreparation = null
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
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
    expect(useFloatingSurfaceRegistration).toHaveBeenCalledWith(false)
    expect(useEscapeDismiss).toHaveBeenCalledWith(false, updateState.closePanel)
  })

  it('registers as a floating surface while open so the native browser view is hidden', () => {
    updateState.panelOpen = true

    expect(UpdatePanel()).not.toBeNull()
    expect(useFloatingSurfaceRegistration).toHaveBeenCalledWith(true)
    expect(useEscapeDismiss).toHaveBeenCalledWith(true, updateState.closePanel)
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

  it('offers automatic installation only when the main process exposes that capability', () => {
    updateState.panelOpen = true
    updateState.snapshot = {
      ...availableSnapshot(),
      phase: 'readyToInstall',
      canInstallAutomatically: true,
    }
    expect(renderToStaticMarkup(React.createElement(UpdatePanel))).toContain('安装并重启')
    updateState.snapshot.canInstallAutomatically = false
    const manual = renderToStaticMarkup(React.createElement(UpdatePanel))
    expect(manual).not.toContain('安装并重启')
    expect(manual).toContain('打开安装包')
  })

  it.each([false, true])(
    'routes retry to the valid next action when a candidate is present=%s',
    (hasCandidate) => {
      updateState.panelOpen = true
      updateState.snapshot = {
        ...availableSnapshot(),
        phase: 'failed',
        availableRelease: hasCandidate ? availableSnapshot().availableRelease : null,
        error: { code: 'download_corrupt', userMessage: '下载失败，请重试', retryable: true },
      }
      const click = findRetryAction(UpdatePanel())
      expect(click).toBeTypeOf('function')
      click!()
      expect(updateState.check).toHaveBeenCalledTimes(hasCandidate ? 0 : 1)
      expect(updateState.startDownload).toHaveBeenCalledTimes(hasCandidate ? 1 : 0)
    },
  )

  it('shows real preparation blockers and prevents dismissal during installation', () => {
    updateState.panelOpen = true
    updateState.snapshot = {
      ...availableSnapshot(),
      phase: 'readyToInstall',
      canInstallAutomatically: true,
    }
    updateState.installPreparation = {
      ok: false,
      confirmationToken: null,
      snapshot: updateState.snapshot,
      impacts: [{ kind: 'editor', severity: 'blocked', label: 'note.md', detail: '未保存' }],
    }
    expect(renderToStaticMarkup(React.createElement(UpdatePanel))).toContain('note.md')
    updateState.snapshot.phase = 'installing'
    const installing = renderToStaticMarkup(React.createElement(UpdatePanel))
    expect(installing).toContain('正在准备安装并重启')
    expect(useEscapeDismiss).toHaveBeenLastCalledWith(false, updateState.closePanel)
  })
})

function findRetryAction(node: React.ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) return node.map(findRetryAction).find(Boolean)
  if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node))
    return undefined
  if (node.type === 'button' && node.props.children === '重试') return node.props.onClick
  return findRetryAction(node.props.children)
}

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
