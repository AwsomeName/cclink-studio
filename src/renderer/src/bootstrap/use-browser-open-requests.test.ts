import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useOpenProjectsStore } from '../stores/open-projects-store'
import { useToastStore } from '../components/common/Toast'
import {
  adoptRequestedBrowserPopup,
  closeRuntimeBrowserTab,
  openRequestedBrowserTab,
} from './use-browser-open-requests'

const workspaceOpenMocks = vi.hoisted(() => ({
  openWorkspaceRef: vi.fn(),
}))

vi.mock('../features/workspace-open/workspace-open-controller', () => ({
  openWorkspaceRef: workspaceOpenMocks.openWorkspaceRef,
}))

const workspaceRef = localWorkspaceRef('/workspace/a')

beforeEach(() => {
  const beginDraft = vi.fn().mockResolvedValue({
    success: true,
    data: { draftId: 'draft-request', browserProfileId: 'profile-request' },
  })
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: { setSection: vi.fn().mockResolvedValue({ success: true }) },
      webResources: { beginDraft },
      browser: {
        beginPopupAdoption: vi.fn().mockResolvedValue(undefined),
        acceptPopup: vi.fn().mockResolvedValue(undefined),
        rejectPopup: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
  useTabStore.setState(useTabStore.getInitialState(), true)
  useOpenProjectsStore.setState(useOpenProjectsStore.getInitialState(), true)
  useToastStore.setState(useToastStore.getInitialState(), true)
  useWorkspaceStore.setState(
    { ...useWorkspaceStore.getInitialState(), activeWorkspaceRef: workspaceRef },
    true,
  )
  workspaceOpenMocks.openWorkspaceRef.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openRequestedBrowserTab', () => {
  it('activates an existing browser tab in the current workspace', async () => {
    useTabStore.setState({
      tabs: [
        { id: 'file-a', type: 'editor', title: '文件', icon: 'F', workspaceRef },
        { id: 'browser-a', type: 'browser', title: '浏览器', icon: 'B', workspaceRef },
      ],
      activeTabId: 'file-a',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://www.baidu.com/',
      workspaceKey: '/workspace/a',
    })

    expect(useTabStore.getState().activeTabId).toBe('browser-a')
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })

  it('ignores the active account Tab and activates the existing ordinary Tab for Agent browsing', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-default',
          type: 'browser',
          title: '默认环境',
          icon: 'B',
          workspaceRef,
          browserProfile: null,
        },
        {
          id: 'browser-account',
          type: 'browser',
          title: '账号环境',
          icon: 'B',
          workspaceRef,
          browserProfile: 'account-profile',
          webResourceRef: { accountId: 'account-a' },
        },
      ],
      activeTabId: 'browser-account',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://www.baidu.com/',
      workspaceKey: '/workspace/a',
    })

    expect(useTabStore.getState().activeTabId).toBe('browser-default')
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })

  it('creates an ordinary Tab when the workspace only has an account Tab', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-account',
          type: 'browser',
          title: '账号环境',
          icon: 'B',
          workspaceRef,
          browserProfile: 'account-profile',
          webResourceRef: { accountId: 'account-a' },
        },
      ],
      activeTabId: 'browser-account',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://www.baidu.com/',
      workspaceKey: '/workspace/a',
    })

    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      type: 'browser',
      browserProfile: null,
      initialUrl: 'https://www.baidu.com/',
    })
  })

  it('creates an ordinary browser tab when the workspace has none', async () => {
    useTabStore.setState({
      tabs: [{ id: 'file-a', type: 'editor', title: '文件', icon: 'F', workspaceRef }],
      activeTabId: 'file-a',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://www.baidu.com/',
      workspaceKey: '/workspace/a',
    })

    const state = useTabStore.getState()
    expect(state.tabs.at(-1)).toMatchObject({
      type: 'browser',
      initialUrl: 'https://www.baidu.com/',
      workspaceRef,
      browserProfile: null,
    })
    expect(state.activeTabId).toBe(state.tabs.at(-1)?.id)
  })

  it('switches from project B back to the detached source project A before opening the new Tab', async () => {
    const workspaceB = localWorkspaceRef('/workspace/b')
    useTabStore.setState({
      tabs: [
        { id: 'file-b', type: 'editor', title: '项目 B', icon: 'F', workspaceRef: workspaceB },
      ],
      activeTabId: 'file-b',
    })
    useWorkspaceStore.setState({ activeWorkspaceRef: workspaceB, generation: 2 })
    useOpenProjectsStore.setState({ openProjectPaths: ['/workspace/a', '/workspace/b'] })
    workspaceOpenMocks.openWorkspaceRef.mockImplementation(async (ref) => {
      useWorkspaceStore.getState().commitActiveWorkspace(ref)
      useTabStore.setState({
        tabs: [
          {
            id: 'browser-a',
            type: 'browser',
            title: '项目 A 独立窗口来源',
            icon: 'B',
            workspaceRef,
            browserProfile: 'account-a-profile',
            webResourceRef: { accountId: 'account-a' },
          },
        ],
        activeTabId: null,
      })
      return ref
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://example.com/from-detached-a',
      workspaceKey: '/workspace/a',
      profileId: 'account-a-profile',
      sourceTabId: 'browser-a',
      forceNew: true,
    })

    expect(workspaceOpenMocks.openWorkspaceRef).toHaveBeenCalledWith(workspaceRef, {
      confirmedRemote: false,
    })
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(workspaceRef)
    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      initialUrl: 'https://example.com/from-detached-a',
      workspaceRef,
      browserProfile: 'account-a-profile',
      webResourceRef: { accountId: 'account-a' },
    })
    expect(useTabStore.getState().tabs.some((tab) => tab.workspaceRef === workspaceB)).toBe(false)
  })

  it('keeps project B unchanged when the detached source project A cannot be activated', async () => {
    const workspaceB = localWorkspaceRef('/workspace/b')
    useWorkspaceStore.setState({ activeWorkspaceRef: workspaceB, generation: 2 })
    useTabStore.setState({
      tabs: [
        { id: 'file-b', type: 'editor', title: '项目 B', icon: 'F', workspaceRef: workspaceB },
      ],
      activeTabId: 'file-b',
    })
    workspaceOpenMocks.openWorkspaceRef.mockRejectedValue(new Error('项目 A 已不存在'))

    await openRequestedBrowserTab({
      initialUrl: 'https://example.com/from-detached-a',
      workspaceKey: '/workspace/a',
      profileId: 'account-a-profile',
      sourceTabId: 'browser-a',
      forceNew: true,
    })

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(workspaceB)
    expect(useTabStore.getState()).toMatchObject({
      tabs: [{ id: 'file-b' }],
      activeTabId: 'file-b',
    })
    expect(useToastStore.getState().message).toContain('无法切换到来源项目')
  })

  it('opens a native-menu request with the same profile and account binding', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '浏览器',
          icon: 'B',
          workspaceRef,
          browserProfile: 'v2ex',
          webResourceRef: { accountId: 'account-v2ex' },
        },
      ],
      activeTabId: 'browser-a',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://www.v2ex.com/t/1',
      workspaceKey: '/workspace/a',
      profileId: 'v2ex',
      sourceTabId: 'browser-a',
      forceNew: true,
    })

    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      initialUrl: 'https://www.v2ex.com/t/1',
      browserProfile: 'v2ex',
      webResourceRef: { accountId: 'account-v2ex' },
      workspaceRef,
    })
  })

  it('rejects a profile-only native-menu request instead of creating a third Browser state', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '错误来源',
          icon: 'B',
          workspaceRef,
          browserProfile: 'profile-only',
        },
      ],
      activeTabId: 'browser-a',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://example.com/next',
      workspaceKey: '/workspace/a',
      profileId: 'profile-only',
      sourceTabId: 'browser-a',
      forceNew: true,
    })

    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useToastStore.getState().message).toContain('来源账号归属不完整')
  })

  it('rejects a native-menu source with conflicting account and draft ownership', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '冲突来源',
          icon: 'B',
          workspaceRef,
          browserProfile: 'conflicted-profile',
          webResourceRef: { accountId: 'account-a' },
          webResourceDraftRef: { draftId: 'draft-a' },
        },
      ],
      activeTabId: 'browser-a',
    })

    await openRequestedBrowserTab({
      initialUrl: 'https://example.com/next',
      workspaceKey: '/workspace/a',
      profileId: 'conflicted-profile',
      sourceTabId: 'browser-a',
      forceNew: true,
    })

    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useToastStore.getState().message).toContain('来源账号归属不完整')
  })
})

describe('browser popup projection', () => {
  it('inherits the source account draft so saving never replaces the logged-in Profile', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '博客园登录',
          icon: 'B',
          workspaceRef,
          browserProfile: 'web-draft-cnblogs',
          webResourceDraftRef: { draftId: 'draft-cnblogs' },
        },
      ],
      activeTabId: 'browser-a',
    })

    expect(
      await adoptRequestedBrowserPopup({
        tabId: 'browser-popup-login',
        sourceTabId: 'browser-a',
        url: 'https://account.cnblogs.com/register',
        workspaceKey: '/workspace/a',
        profileId: 'web-draft-cnblogs',
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).toBe(true)

    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      id: 'browser-popup-login',
      browserProfile: 'web-draft-cnblogs',
      webResourceDraftRef: { draftId: 'draft-cnblogs' },
    })
  })

  it('adopts a foreground popup with the runtime tabId and inherited profile', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '公众号',
          icon: 'B',
          workspaceRef,
          browserProfile: 'wechat',
          webResourceRef: { accountId: 'account-wechat' },
        },
      ],
      activeTabId: 'browser-a',
    })

    expect(
      await adoptRequestedBrowserPopup({
        tabId: 'browser-popup-1',
        sourceTabId: 'browser-a',
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
          webResourceRef: { accountId: 'account-wechat' },
          workspaceRef,
        },
      ],
    })
    expect(window.cclinkStudio.browser.acceptPopup).toHaveBeenCalledWith('browser-popup-1')
  })

  it('keeps the current tab active for a background popup', async () => {
    useTabStore.setState({
      tabs: [{ id: 'browser-a', type: 'browser', title: '来源', icon: 'B', workspaceRef }],
      activeTabId: 'browser-a',
    })

    await adoptRequestedBrowserPopup({
      tabId: 'browser-popup-background',
      sourceTabId: 'browser-a',
      url: 'https://example.com/background',
      workspaceKey: '/workspace/a',
      profileId: null,
      disposition: 'background-tab',
      activate: false,
    })

    expect(useTabStore.getState().activeTabId).toBe('browser-a')
    expect(useTabStore.getState().tabs.at(-1)?.id).toBe('browser-popup-background')
  })

  it('rejects a popup when its source workspace cannot be activated', async () => {
    workspaceOpenMocks.openWorkspaceRef.mockRejectedValue(new Error('项目不可用'))
    expect(
      await adoptRequestedBrowserPopup({
        tabId: 'browser-popup-wrong-workspace',
        sourceTabId: 'browser-a',
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

  it('switches back to project A before adopting a popup created by its detached Browser', async () => {
    const workspaceB = localWorkspaceRef('/workspace/b')
    useWorkspaceStore.setState({ activeWorkspaceRef: workspaceB, generation: 2 })
    useTabStore.setState({
      tabs: [
        { id: 'file-b', type: 'editor', title: '项目 B', icon: 'F', workspaceRef: workspaceB },
      ],
      activeTabId: 'file-b',
    })
    workspaceOpenMocks.openWorkspaceRef.mockImplementation(async (ref) => {
      useWorkspaceStore.getState().commitActiveWorkspace(ref)
      useTabStore.setState({
        tabs: [
          {
            id: 'browser-a',
            type: 'browser',
            title: '项目 A 独立窗口来源',
            icon: 'B',
            workspaceRef,
            browserProfile: 'account-a-profile',
            webResourceRef: { accountId: 'account-a' },
          },
        ],
        activeTabId: null,
      })
      return ref
    })

    await expect(
      adoptRequestedBrowserPopup({
        tabId: 'browser-popup-project-a',
        sourceTabId: 'browser-a',
        url: 'https://example.com/popup-a',
        workspaceKey: '/workspace/a',
        profileId: 'account-a-profile',
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).resolves.toBe(true)

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(workspaceRef)
    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      id: 'browser-popup-project-a',
      workspaceRef,
      browserProfile: 'account-a-profile',
      webResourceRef: { accountId: 'account-a' },
    })
    expect(window.cclinkStudio.browser.acceptPopup).toHaveBeenCalledWith('browser-popup-project-a')
  })

  it('claims a cross-project popup before waiting for a slow workspace switch', async () => {
    const workspaceB = localWorkspaceRef('/workspace/b')
    useWorkspaceStore.setState({ activeWorkspaceRef: workspaceB, generation: 2 })
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: '项目 A 独立窗口来源',
          icon: 'B',
          workspaceRef,
          browserProfile: 'account-a-profile',
          webResourceRef: { accountId: 'account-a' },
        },
        { id: 'file-b', type: 'editor', title: '项目 B', icon: 'F', workspaceRef: workspaceB },
      ],
      activeTabId: 'file-b',
    })

    let finishSwitch: (() => void) | undefined
    workspaceOpenMocks.openWorkspaceRef.mockImplementation(
      (ref) =>
        new Promise((resolve) => {
          finishSwitch = () => {
            useWorkspaceStore.getState().commitActiveWorkspace(ref)
            useTabStore.setState({
              tabs: useTabStore
                .getState()
                .tabs.filter(
                  (tab) =>
                    tab.workspaceRef?.kind === 'local' && tab.workspaceRef.path === '/workspace/a',
                ),
              activeTabId: null,
            })
            resolve(ref)
          }
        }),
    )

    const adoption = adoptRequestedBrowserPopup({
      tabId: 'browser-popup-slow-switch',
      sourceTabId: 'browser-a',
      url: 'https://example.com/slow-popup',
      workspaceKey: '/workspace/a',
      profileId: 'account-a-profile',
      disposition: 'foreground-tab',
      activate: true,
    })

    await vi.waitFor(() => {
      expect(window.cclinkStudio.browser.beginPopupAdoption).toHaveBeenCalledWith(
        'browser-popup-slow-switch',
      )
    })
    expect(workspaceOpenMocks.openWorkspaceRef).toHaveBeenCalled()
    expect(window.cclinkStudio.browser.acceptPopup).not.toHaveBeenCalled()

    finishSwitch?.()
    await expect(adoption).resolves.toBe(true)
    expect(window.cclinkStudio.browser.acceptPopup).toHaveBeenCalledWith(
      'browser-popup-slow-switch',
    )
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
