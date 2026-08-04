import { beforeEach, describe, expect, it } from 'vitest'
import type { WebResourceConnection } from '@shared/web-resources/web-resource-types'
import { useTabStore } from '../../stores'
import { ensureWebResourceTab } from './web-resource-tab'

const workspaceRef = { kind: 'local' as const, path: '/tmp/project' }
const now = new Date().toISOString()

const connection: WebResourceConnection = {
  website: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'App Store Connect',
    origin: 'https://appstoreconnect.apple.com',
    entryUrl: 'https://appstoreconnect.apple.com/apps',
    createdAt: now,
    updatedAt: now,
  },
  principal: {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'company',
    name: 'Example Ltd.',
    createdAt: now,
    updatedAt: now,
  },
  account: {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    websiteId: '11111111-1111-4111-8111-111111111111',
    principalId: '22222222-2222-4222-8222-222222222222',
    label: 'Release account',
    browserProfileId: 'release-profile',
    createdAt: now,
    updatedAt: now,
  },
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('ensureWebResourceTab', () => {
  it('opens one Browser Tab projection and focuses it on repeated launches', () => {
    const firstId = ensureWebResourceTab(connection, workspaceRef)
    const secondId = ensureWebResourceTab(connection, workspaceRef)

    expect(secondId).toBe(firstId)
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: firstId,
        type: 'browser',
        title: 'App Store Connect · Example Ltd.',
        initialUrl: 'https://appstoreconnect.apple.com/apps',
        browserProfile: 'release-profile',
        webResourceRef: {
          projectId: '44444444-4444-4444-8444-444444444444',
          accountId: '33333333-3333-4333-8333-333333333333',
        },
        workspaceRef,
      }),
    ])
  })

  it('refuses to launch a migrated resource before project assignment', () => {
    expect(() =>
      ensureWebResourceTab(
        { ...connection, account: { ...connection.account, projectId: null } },
        workspaceRef,
      ),
    ).toThrow('尚未归属当前项目')
  })
})
