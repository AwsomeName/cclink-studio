import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import { registerWebResourceIpc } from './web-resource-ipc'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_SCOPE = { workspaceRef: { kind: 'local' as const, path: '/Users/example/project' } }

describe('registerWebResourceIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
  })

  it('rejects an untrusted sender before reading metadata', () => {
    const service = {
      getSnapshot: vi.fn(() => ({ success: true, data: {} })),
    }
    registerWebResourceIpc(
      () => service as never,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
    )

    expect(() =>
      mockIpcMain.handlers.get('webResources:getSnapshot')?.({ sender: 'other' }),
    ).toThrow('untrusted')
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('maps invalid renderer input to a bounded error without calling the service', async () => {
    const service = {
      createConnection: vi.fn(),
    }
    registerWebResourceIpc(
      () => service as never,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:createConnection')?.(
        { sender: 'trusted' },
        {
          websiteName: 'Unsafe',
          entryUrl: 'file:///etc/passwd',
          principalKind: 'company',
          principalName: 'Example Ltd.',
          accountLabel: 'Account',
          workspaceRef: PROJECT_SCOPE.workspaceRef,
        },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT' },
    })
    expect(service.createConnection).not.toHaveBeenCalled()
  })

  it('returns a structured result when service startup degraded', async () => {
    registerWebResourceIpc(
      () => null,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:getSnapshot')?.({ sender: 'trusted' }, PROJECT_SCOPE),
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '网站与账号服务当前不可用，其他工作台能力不受影响',
      },
    })
  })

  it('derives an ordinary tab Profile in main before creating its save draft', async () => {
    const service = { beginDraft: vi.fn(async () => ({ success: true, data: {} })) }
    const browserManager = {
      getDraftAdoptionProfileId: vi.fn(() => 'ordinary-profile'),
    }
    registerWebResourceIpc(
      () => service as never,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
      () => browserManager as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:beginDraft')?.(
        { sender: 'trusted' },
        { ...PROJECT_SCOPE, tabId: 'ordinary-tab' },
      ),
    ).resolves.toMatchObject({ success: true })
    expect(browserManager.getDraftAdoptionProfileId).toHaveBeenCalledWith(
      'ordinary-tab',
      '/Users/example/project',
    )
    expect(service.beginDraft).toHaveBeenCalledWith(PROJECT_ID, 'ordinary-profile')
  })

  it('rejects a stale or cross-workspace ordinary tab before creating a draft', async () => {
    const service = { beginDraft: vi.fn() }
    const browserManager = { getDraftAdoptionProfileId: vi.fn(() => undefined) }
    registerWebResourceIpc(
      () => service as never,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
      () => browserManager as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:beginDraft')?.(
        { sender: 'trusted' },
        { ...PROJECT_SCOPE, tabId: 'stale-tab' },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_BROWSER_STATE' },
    })
    expect(service.beginDraft).not.toHaveBeenCalled()
  })

  it('preserves a logged-in default or shared Profile instead of replacing and reloading it', async () => {
    const service = { beginDraft: vi.fn() }
    const browserManager = { getDraftAdoptionProfileId: vi.fn(() => null) }
    registerWebResourceIpc(
      () => service as never,
      () => null,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
      () => browserManager as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:beginDraft')?.(
        { sender: 'trusted' },
        { ...PROJECT_SCOPE, tabId: 'logged-in-shared-tab' },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: 'INVALID_BROWSER_STATE',
        message: expect.stringMatching(/账号未保存.*页面和登录状态已保留/),
      },
    })
    expect(service.beginDraft).not.toHaveBeenCalled()
  })

  it('imports a valid legacy project config idempotently and preserves its Profile ids', async () => {
    const service = {
      createConnection: vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: {} })
        .mockResolvedValueOnce({ success: true, data: {} })
        .mockResolvedValueOnce({
          success: false,
          error: { code: 'DUPLICATE_ACCOUNT', message: 'duplicate' },
        })
        .mockResolvedValueOnce({
          success: false,
          error: { code: 'DUPLICATE_ACCOUNT', message: 'duplicate' },
        }),
    }
    const projectOps = {
      getAccounts: vi.fn(async () => ({
        exists: true,
        filePath: '/Users/example/project/cclink-accounts.json',
        issues: [],
        config: {
          version: 1,
          platforms: [
            {
              id: 'apple-review',
              name: 'App Store Connect',
              url: 'https://appstoreconnect.apple.com',
              account: 'Release',
              browserProfile: 'apple-release',
            },
            {
              id: 'aliyun',
              name: '阿里云',
              url: 'https://beian.aliyun.com',
            },
          ],
        },
      })),
    }
    registerWebResourceIpc(
      () => service as never,
      () => projectOps as never,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
    )

    const input = {
      workspacePath: '/Users/example/project',
      principalKind: 'company',
      principalName: 'Example Ltd.',
    }
    const handler = mockIpcMain.handlers.get('webResources:importProjectOpsConfig')

    await expect(handler?.({ sender: 'trusted' }, input)).resolves.toMatchObject({
      success: true,
      data: { totalCount: 2, importedCount: 2, skippedCount: 0 },
    })
    expect(service.createConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceRef: PROJECT_SCOPE.workspaceRef,
        principalName: 'Example Ltd.',
      }),
      PROJECT_ID,
      'apple-release',
    )
    expect(service.createConnection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workspaceRef: PROJECT_SCOPE.workspaceRef }),
      PROJECT_ID,
      'aliyun',
    )
    await expect(handler?.({ sender: 'trusted' }, input)).resolves.toMatchObject({
      success: true,
      data: { totalCount: 2, importedCount: 0, skippedCount: 2 },
    })
  })

  it('returns a bounded import error when the workspace is outside allowed roots', async () => {
    const service = { createConnection: vi.fn() }
    const projectOps = {
      getAccounts: vi.fn(async () => {
        throw new Error('工作空间不在允许范围内: /etc')
      }),
    }
    registerWebResourceIpc(
      () => service as never,
      () => projectOps as never,
      () => createWorkspaceState() as never,
      createGuard('trusted') as never,
    )

    await expect(
      mockIpcMain.handlers.get('webResources:importProjectOpsConfig')?.(
        { sender: 'trusted' },
        { workspacePath: '/etc', principalKind: 'company', principalName: 'Example Ltd.' },
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'PROJECT_OPS_CONFIG_INVALID',
        message: '无法读取或导入旧运营配置',
      },
    })
    expect(service.createConnection).not.toHaveBeenCalled()
  })
})

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}

function createWorkspaceState() {
  return {
    getLocalProjectId: vi.fn(async () => PROJECT_ID),
  }
}
