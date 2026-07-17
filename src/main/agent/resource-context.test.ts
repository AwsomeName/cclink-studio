import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../settings/types'
import { buildAgentResourceContext, inferTaskIntent } from './resource-context'

describe('agent resource context intent inference', () => {
  it('recognizes Zhihu login tasks with expected hosts', () => {
    expect(inferTaskIntent('登录我的知乎')).toEqual({
      kind: 'browser_login',
      confidence: 'high',
      targetSite: 'zhihu',
      expectedHosts: ['www.zhihu.com', 'zhihu.com'],
      preferredUrl: 'https://www.zhihu.com/signin',
      reason: '用户要求登录 zhihu',
    })
  })

  it('recognizes publish workflows as browser publish tasks', () => {
    const intent = inferTaskIntent('帮我去微信公众号投稿')
    expect(intent.kind).toBe('browser_publish')
    expect(intent.targetSite).toBe('wechat_mp')
    expect(intent.expectedHosts).toEqual(['mp.weixin.qq.com'])
  })

  it('keeps vague messages as general tasks', () => {
    expect(inferTaskIntent('我们继续看看方案')).toMatchObject({
      kind: 'general',
      confidence: 'low',
    })
  })

  it('uses the conversation workspace instead of the currently selected project', async () => {
    const snapshot = await buildAgentResourceContext({
      message: '继续',
      scope: { kind: 'all' },
      browserTabId: null,
      context: {
        workspaceRef: { kind: 'local', path: '/Users/apple/Desktop/previous-project' },
      },
      playwrightBridge: {
        getPageDiagnostics: async () => null,
      } as never,
      settings: {
        ...DEFAULT_SETTINGS,
        lastWorkspacePath: '/Users/apple/Desktop/current-project',
      },
    })

    expect(snapshot.workspace).toEqual({
      ref: { kind: 'local', path: '/Users/apple/Desktop/previous-project' },
      key: '/Users/apple/Desktop/previous-project',
      rootPath: '/Users/apple/Desktop/previous-project',
      writable: true,
    })
  })

  it('does not expose a browser owned by another project', async () => {
    const getPageDiagnostics = vi.fn(async () => ({
      url: 'https://www.zhihu.com/signin',
      title: '知乎',
    }))
    const snapshot = await buildAgentResourceContext({
      message: '继续处理文档',
      scope: { kind: 'all' },
      browserTabId: 'project-b-browser',
      context: {
        workspaceRef: { kind: 'local', path: '/workspace/a' },
      },
      browserManager: {
        getViewIdForWorkspace: () => null,
        getViewWorkspaceKey: () => '/workspace/b',
      } as never,
      playwrightBridge: { getPageDiagnostics } as never,
      settings: DEFAULT_SETTINGS,
    })

    expect(snapshot.activeBrowser).toBeNull()
    expect(getPageDiagnostics).not.toHaveBeenCalled()
  })
})
