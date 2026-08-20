import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalWorkspaceRef, localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { openDefaultBrowserTab } from './open-default-browser-tab'

const workspaceRef = localWorkspaceRef('/workspace/current')
const beginDraft = vi.fn()

beforeEach(() => {
  beginDraft.mockReset()
  vi.stubGlobal('window', {
    cclinkStudio: {
      webResources: { beginDraft },
      workspaceState: { setSection: vi.fn().mockResolvedValue({ success: true }) },
    },
  })
  useTabStore.setState({ tabs: [], activeTabId: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openDefaultBrowserTab', () => {
  it('opens the default tab with the existing save-to-project draft flow', async () => {
    beginDraft.mockResolvedValue({
      success: true,
      data: { draftId: 'draft-id', browserProfileId: 'web-draft-profile' },
    })

    const result = await openDefaultBrowserTab(workspaceRef)

    expect(beginDraft).toHaveBeenCalledWith({ workspaceRef })
    expect(result.saveable).toBe(true)
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: result.tabId,
        type: 'browser',
        title: '浏览器',
        browserProfile: 'web-draft-profile',
        webResourceDraftRef: { draftId: 'draft-id' },
        workspaceRef,
        initialUrl: 'about:blank',
      }),
    ])
  })

  it('keeps the basic browser available when the account service is unavailable', async () => {
    beginDraft.mockResolvedValue({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
    })

    const result = await openDefaultBrowserTab(workspaceRef)

    expect(result).toMatchObject({
      saveable: false,
      error: '网站与账号服务尚未就绪',
    })
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: result.tabId,
        type: 'browser',
        title: '浏览器',
        workspaceRef,
        initialUrl: 'about:blank',
      }),
    ])
    expect(useTabStore.getState().tabs[0].webResourceDraftRef).toBeUndefined()
  })

  it('loads an ordinary web target inside the same saveable draft flow', async () => {
    beginDraft.mockResolvedValue({
      success: true,
      data: { draftId: 'ordinary-draft', browserProfileId: 'ordinary-profile' },
    })

    const result = await openDefaultBrowserTab(workspaceRef, {
      initialUrl: 'https://www.oschina.net/',
      title: '开源中国',
    })

    expect(result.saveable).toBe(true)
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: '开源中国',
      initialUrl: 'https://www.oschina.net/',
      browserProfile: 'ordinary-profile',
      webResourceDraftRef: { draftId: 'ordinary-draft' },
    })
  })

  it('opens a plain browser outside a local project', async () => {
    const result = await openDefaultBrowserTab(globalWorkspaceRef())

    expect(beginDraft).not.toHaveBeenCalled()
    expect(result).toMatchObject({ saveable: false, error: '请先打开一个本地项目' })
    expect(useTabStore.getState().tabs[0]).toEqual(
      expect.objectContaining({ initialUrl: 'about:blank' }),
    )
  })
})
