import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalWorkspaceRef, localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { openDefaultBrowserTab, openWebAccountDraftTab } from './open-default-browser-tab'

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
  it('opens ordinary browsing without creating an account draft', async () => {
    const result = await openDefaultBrowserTab(workspaceRef)

    expect(beginDraft).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: result.tabId,
        type: 'browser',
        title: '浏览器',
        browserProfile: null,
        webResourceRef: undefined,
        webResourceDraftRef: undefined,
        workspaceRef,
        initialUrl: 'about:blank',
      }),
    ])
  })

  it('loads ordinary web targets in the shared default environment', async () => {
    await openDefaultBrowserTab(workspaceRef, {
      initialUrl: 'https://www.oschina.net/',
      title: '开源中国',
    })

    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: '开源中国',
      initialUrl: 'https://www.oschina.net/',
      browserProfile: null,
    })
  })

  it('keeps ordinary browsing available outside a local project', async () => {
    const result = await openDefaultBrowserTab(globalWorkspaceRef())

    expect(beginDraft).not.toHaveBeenCalled()
    expect(result.tabId).toBeTruthy()
    expect(useTabStore.getState().tabs[0]).toEqual(
      expect.objectContaining({ initialUrl: 'about:blank', browserProfile: null }),
    )
  })
})

describe('openWebAccountDraftTab', () => {
  it('creates an isolated Profile only for explicit account creation', async () => {
    beginDraft.mockResolvedValue({
      success: true,
      data: { draftId: 'draft-id', browserProfileId: 'web-draft-profile' },
    })

    const result = await openWebAccountDraftTab(workspaceRef)

    expect(beginDraft).toHaveBeenCalledWith({ workspaceRef })
    expect(result.success).toBe(true)
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      id: result.tabId,
      browserProfile: 'web-draft-profile',
      webResourceDraftRef: { draftId: 'draft-id' },
    })
  })

  it('does not silently fall back to ordinary browsing when draft creation fails', async () => {
    beginDraft.mockResolvedValue({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
    })

    await expect(openWebAccountDraftTab(workspaceRef)).resolves.toMatchObject({
      success: false,
      error: '网站与账号服务尚未就绪',
    })
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('does not open a tab when account creation has no local project', async () => {
    await expect(openWebAccountDraftTab(globalWorkspaceRef())).resolves.toEqual({
      tabId: '',
      success: false,
      error: '请先打开一个本地项目',
    })
    expect(beginDraft).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs).toEqual([])
  })
})
