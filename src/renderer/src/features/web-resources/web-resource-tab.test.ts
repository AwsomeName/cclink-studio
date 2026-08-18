import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebResourceLaunchDescriptor } from '@shared/web-resources/web-resource-types'
import { useTabStore } from '../../stores'
import { resolveAndOpenWebResourceTab } from './web-resource-tab'

const workspaceRef = { kind: 'local' as const, path: '/tmp/project' }
const launch: WebResourceLaunchDescriptor = {
  title: 'App Store Connect',
  entryUrl: 'https://appstoreconnect.apple.com/apps',
  browserProfileId: 'release-profile',
  webResourceRef: {
    accountId: '33333333-3333-4333-8333-333333333333',
  },
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('ensureWebResourceTab', () => {
  it('resolves in main, opens one Browser Tab projection and focuses it on repeated launches', async () => {
    const resolveLaunch = vi.fn().mockResolvedValue({ success: true, data: launch })
    vi.stubGlobal('window', { cclinkStudio: { webResources: { resolveLaunch } } })

    const firstId = await resolveAndOpenWebResourceTab(
      launch.webResourceRef.accountId,
      workspaceRef,
    )
    const secondId = await resolveAndOpenWebResourceTab(
      launch.webResourceRef.accountId,
      workspaceRef,
    )

    expect(secondId).toBe(firstId)
    expect(resolveLaunch).toHaveBeenCalledWith({
      workspaceRef,
      accountId: launch.webResourceRef.accountId,
    })
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: firstId,
        type: 'browser',
        title: 'App Store Connect',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'release-profile',
        webResourceRef: {
          accountId: '33333333-3333-4333-8333-333333333333',
        },
        workspaceRef,
      }),
    ])
  })

  it('surfaces a missing global account and does not create a tab', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        webResources: {
          resolveLaunch: vi.fn().mockResolvedValue({
            success: false,
            error: { code: 'RESOURCE_NOT_FOUND', message: '网站账号不存在或已归档' },
          }),
        },
      },
    })

    await expect(
      resolveAndOpenWebResourceTab(launch.webResourceRef.accountId, workspaceRef),
    ).rejects.toThrow('网站账号不存在或已归档')
    expect(useTabStore.getState().tabs).toEqual([])
  })
})
