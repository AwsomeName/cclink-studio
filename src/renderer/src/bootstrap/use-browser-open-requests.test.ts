import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import {
  adoptRequestedBrowserPopup,
  closeRuntimeBrowserTab,
  openRequestedBrowserTab,
} from './use-browser-open-requests'

const workspaceRef = localWorkspaceRef('/workspace/a')

beforeEach(() => {
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: { setSection: vi.fn().mockResolvedValue({ success: true }) },
      browser: {
        acceptPopup: vi.fn().mockResolvedValue(undefined),
        rejectPopup: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
  useTabStore.setState(useTabStore.getInitialState(), true)
  useWorkspaceStore.setState(
    { ...useWorkspaceStore.getInitialState(), activeWorkspaceRef: workspaceRef },
    true,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openRequestedBrowserTab', () => {
  it('activates an existing browser tab in the current workspace', () => {
    useTabStore.setState({
      tabs: [
        { id: 'file-a', type: 'editor', title: '文件', icon: 'F', workspaceRef },
        { id: 'browser-a', type: 'browser', title: '浏览器', icon: 'B', workspaceRef },
      ],
      activeTabId: 'file-a',
    })

    openRequestedBrowserTab({ initialUrl: 'https://www.baidu.com/', workspaceKey: '/workspace/a' })

    expect(useTabStore.getState().activeTabId).toBe('browser-a')
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })

  it('creates a visible browser tab when the workspace has none', () => {
    useTabStore.setState({
      tabs: [{ id: 'file-a', type: 'editor', title: '文件', icon: 'F', workspaceRef }],
      activeTabId: 'file-a',
    })

    openRequestedBrowserTab({ initialUrl: 'https://www.baidu.com/', workspaceKey: '/workspace/a' })

    const state = useTabStore.getState()
    expect(state.tabs.at(-1)).toMatchObject({
      type: 'browser',
      initialUrl: 'https://www.baidu.com/',
      workspaceRef,
    })
    expect(state.activeTabId).toBe(state.tabs.at(-1)?.id)
  })

  it('ignores browser requests from a background workspace', () => {
    useTabStore.setState({
      tabs: [{ id: 'file-a', type: 'editor', title: '文件', icon: 'F', workspaceRef }],
      activeTabId: 'file-a',
    })

    openRequestedBrowserTab({
      initialUrl: 'https://www.zhihu.com/signin',
      workspaceKey: '/workspace/b',
    })

    expect(useTabStore.getState()).toMatchObject({
      tabs: [{ id: 'file-a' }],
      activeTabId: 'file-a',
    })
  })

  it('opens an explicit native-menu request in a new tab with the same profile', () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '浏览器',
          icon: 'B',
          workspaceRef,
          browserProfile: 'v2ex',
        },
      ],
      activeTabId: 'browser-a',
    })

    openRequestedBrowserTab({
      initialUrl: 'https://www.v2ex.com/t/1',
      workspaceKey: '/workspace/a',
      profileId: 'v2ex',
      forceNew: true,
    })

    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      initialUrl: 'https://www.v2ex.com/t/1',
      browserProfile: 'v2ex',
      workspaceRef,
    })
  })
})

describe('browser popup projection', () => {
  it('adopts a foreground popup with the runtime tabId and inherited profile', async () => {
    useTabStore.setState({
      tabs: [{ id: 'browser-a', type: 'browser', title: '公众号', icon: 'B', workspaceRef }],
      activeTabId: 'browser-a',
    })

    expect(
      adoptRequestedBrowserPopup({
        tabId: 'browser-popup-1',
        url: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
        workspaceKey: '/workspace/a',
        profileId: 'wechat',
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).toBe(true)

    expect(useTabStore.getState()).toMatchObject({
      activeTabId: 'browser-popup-1',
      tabs: [
        { id: 'browser-a' },
        {
          id: 'browser-popup-1',
          type: 'browser',
          initialUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
          browserProfile: 'wechat',
          workspaceRef,
        },
      ],
    })
    expect(window.cclinkStudio.browser.acceptPopup).toHaveBeenCalledWith('browser-popup-1')
  })

  it('keeps the current tab active for a background popup', () => {
    useTabStore.setState({
      tabs: [{ id: 'browser-a', type: 'browser', title: '来源', icon: 'B', workspaceRef }],
      activeTabId: 'browser-a',
    })

    adoptRequestedBrowserPopup({
      tabId: 'browser-popup-background',
      url: 'https://example.com/background',
      workspaceKey: '/workspace/a',
      profileId: null,
      disposition: 'background-tab',
      activate: false,
    })

    expect(useTabStore.getState().activeTabId).toBe('browser-a')
    expect(useTabStore.getState().tabs.at(-1)?.id).toBe('browser-popup-background')
  })

  it('rejects a popup from a workspace that is no longer active', () => {
    expect(
      adoptRequestedBrowserPopup({
        tabId: 'browser-popup-wrong-workspace',
        url: 'https://example.com/',
        workspaceKey: '/workspace/b',
        profileId: null,
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).toBe(false)

    expect(window.cclinkStudio.browser.rejectPopup).toHaveBeenCalledWith(
      'browser-popup-wrong-workspace',
    )
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })

  it('removes the visible projection when the popup closes itself', () => {
    useTabStore.getState().adoptBrowserRuntimeTab({
      id: 'browser-popup-close',
      title: 'Popup',
      initialUrl: 'https://example.com/',
      browserProfile: null,
      workspaceRef,
      activate: true,
    })

    closeRuntimeBrowserTab({ tabId: 'browser-popup-close', workspaceKey: '/workspace/a' })

    expect(useTabStore.getState().tabs).toHaveLength(0)
    expect(useTabStore.getState().activeTabId).toBeNull()
  })
})
