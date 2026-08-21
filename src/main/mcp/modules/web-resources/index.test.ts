import { describe, expect, it, vi } from 'vitest'
import { WebResourceToolModule } from '.'

describe('WebResourceToolModule', () => {
  it('lists safe global account metadata without exposing session or profile data', async () => {
    const getSnapshot = vi.fn(() => ({
      success: true as const,
      data: {
        schemaVersion: 3 as const,
        revision: 7,
        websites: [
          {
            id: 'website-1',
            name: 'Apple Developer',
            origin: 'https://developer.apple.com',
            entryUrl: 'https://developer.apple.com/account/private-path',
            notes: 'private website note',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
        principals: [
          {
            id: 'principal-1',
            kind: 'company' as const,
            name: '张三公司',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
        accounts: [
          {
            id: 'account-1',
            websiteId: 'website-1',
            principalId: 'principal-1',
            label: '发行账号',
            role: '管理员',
            browserProfileId: 'secret-profile-id',
            loginHint: 'private-login-hint',
            loginConfirmedAt: '2026-08-18T01:00:00.000Z',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
        accountGroups: [
          {
            id: 'group-1',
            name: '国内发布矩阵',
            revision: 2,
            accountIds: ['account-1'],
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
      },
    }))
    const module = new WebResourceToolModule({ getSnapshot } as never)

    const result = await module.execute('web_accounts_list', {})

    expect(result).toMatchObject({
      success: true,
      data: {
        revision: 7,
        accountCount: 1,
        accounts: [
          {
            accountId: 'account-1',
            accountName: '发行账号',
            websiteName: 'Apple Developer',
            websiteOrigin: 'https://developer.apple.com',
            principalName: '张三公司',
            principalKind: 'company',
            role: '管理员',
            loginStatus: 'user-confirmed',
            archived: false,
          },
        ],
        accountGroups: [
          {
            groupId: 'group-1',
            name: '国内发布矩阵',
            revision: 2,
            members: [{ accountId: 'account-1', accountName: '发行账号' }],
          },
        ],
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret-profile-id')
    expect(serialized).not.toContain('private-login-hint')
    expect(serialized).not.toContain('private website note')
    expect(serialized).not.toContain('/account/private-path')
  })

  it('keeps archived accounts hidden unless explicitly requested', async () => {
    const getSnapshot = vi.fn(() => ({
      success: true as const,
      data: {
        schemaVersion: 3 as const,
        revision: 1,
        websites: [],
        principals: [],
        accounts: [
          {
            id: 'archived-account',
            websiteId: 'missing',
            principalId: 'missing',
            label: '旧账号',
            browserProfileId: 'profile',
            archivedAt: '2026-08-18T02:00:00.000Z',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T02:00:00.000Z',
          },
        ],
        accountGroups: [],
      },
    }))
    const module = new WebResourceToolModule({ getSnapshot } as never)

    await expect(module.execute('web_accounts_list', {})).resolves.toMatchObject({
      success: true,
      data: { accountCount: 0, accounts: [] },
    })
    await expect(
      module.execute('web_accounts_list', { includeArchived: true }),
    ).resolves.toMatchObject({
      success: true,
      data: { accountCount: 1, accounts: [{ accountName: '旧账号', archived: true }] },
    })
  })

  it('opens one explicit account through the trusted visible-tab bridge without exposing profile data', async () => {
    const accountId = '4fa85f64-5717-4562-b3fc-2c963f66afa6'
    const resolveLaunch = vi.fn(() => ({
      success: true as const,
      data: {
        webResourceRef: { accountId },
        title: 'Apple Developer',
        entryUrl: 'https://developer.apple.com/account/private',
        browserProfileId: 'secret-profile-id',
      },
    }))
    const getSnapshot = vi.fn(() => ({
      success: true as const,
      data: {
        schemaVersion: 3 as const,
        revision: 1,
        websites: [
          {
            id: 'website-1',
            name: 'Apple Developer',
            origin: 'https://developer.apple.com',
            entryUrl: 'https://developer.apple.com/account/private',
          },
        ],
        principals: [{ id: 'principal-1', kind: 'company', name: '张三公司' }],
        accounts: [
          {
            id: accountId,
            websiteId: 'website-1',
            principalId: 'principal-1',
            label: '发行账号',
            browserProfileId: 'secret-profile-id',
            loginConfirmedAt: '2026-08-18T01:00:00.000Z',
          },
        ],
        accountGroups: [],
      },
    }))
    const requestLaunch = vi.fn().mockResolvedValue({ tabId: 'account-tab' })
    const waitForViewBinding = vi.fn().mockResolvedValue(true)
    const startTask = vi.fn().mockReturnValue({ id: 'browser-task' })
    const module = new WebResourceToolModule({ resolveLaunch, getSnapshot } as never, {
      launchCoordinator: { requestLaunch } as never,
      browserManager: { waitForViewBinding } as never,
      browserTaskRuntime: {
        cancelTaskForConversation: vi.fn(),
        startTask,
      } as never,
    })

    const result = await module.execute(
      'web_account_open',
      { accountId },
      {
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentGoal: '检查苹果审核状态',
        trustedWorkspace: {
          kind: 'local',
          rootPath: '/workspace/a',
          workspaceKey: '/workspace/a',
        },
      },
    )

    expect(requestLaunch).toHaveBeenCalledWith(
      { kind: 'local', path: '/workspace/a' },
      expect.objectContaining({ browserProfileId: 'secret-profile-id' }),
    )
    expect(waitForViewBinding).toHaveBeenCalledWith(
      'account-tab',
      '/workspace/a',
      'secret-profile-id',
    )
    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'account-tab',
        correlation: expect.objectContaining({ accountId, profileId: 'secret-profile-id' }),
      }),
    )
    expect(JSON.stringify(result)).not.toContain('secret-profile-id')
    expect(result).toMatchObject({
      success: true,
      data: { accountId, tabId: 'account-tab', browserTaskId: 'browser-task' },
    })
  })
})
