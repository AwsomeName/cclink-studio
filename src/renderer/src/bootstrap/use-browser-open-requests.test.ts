import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { openRequestedBrowserTab } from './use-browser-open-requests'

const workspaceRef = localWorkspaceRef('/workspace/a')

beforeEach(() => {
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: { setSection: vi.fn().mockResolvedValue({ success: true }) },
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
