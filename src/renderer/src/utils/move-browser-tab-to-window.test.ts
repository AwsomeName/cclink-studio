import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrowserStore } from '../stores/browser-store'
import { useTabStore } from '../stores/tab-store'
import { useWorkbenchWindowStore } from '../stores/workbench-window-store'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  setWorkspaceStateKey,
  setWorkspaceStateOwnerKey,
} from './workspace-state'
import { moveBrowserTabToNewWindow } from './move-browser-tab-to-window'

describe('moveBrowserTabToNewWindow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setWorkspaceStateKey(null)
    setWorkspaceStateOwnerKey(null)
  })

  it('supplies a bounded transient projection for a non-persisted Browser draft', async () => {
    const moveTabToNewWindow = vi.fn().mockResolvedValue({
      success: true,
      transferId: 'transfer-1',
      projection: { placements: [] },
    })
    vi.stubGlobal('window', {
      cclinkStudio: {
        workbenchWindow: { moveTabToNewWindow },
      },
    })
    setWorkspaceStateKey('/workspace')
    setWorkspaceStateOwnerKey('local:test')
    beginWorkspaceStateRestore()
    useTabStore.setState({
      tabs: [
        {
          id: 'draft-browser',
          type: 'browser',
          title: '网站账号草稿',
          icon: '🌐',
          initialUrl: 'about:blank',
          browserProfile: 'draft-profile',
          webResourceDraftRef: { draftId: 'draft-1' },
          workspaceRef: { kind: 'local', path: '/workspace' },
        },
      ],
      activeTabId: 'draft-browser',
    })
    useBrowserStore.setState({
      tabs: {
        'draft-browser': {
          url: 'https://example.com/current',
          urlInput: 'https://example.com/current',
          viewMode: 'desktop',
          zoomMode: 'fit',
          zoomFactor: 1,
          ready: true,
          history: ['https://example.com/current'],
          historyIndex: 0,
        },
      },
    })
    useWorkbenchWindowStore.setState({ placements: {} })
    endWorkspaceStateRestore()

    await moveBrowserTabToNewWindow('draft-browser')

    expect(moveTabToNewWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 'draft-browser',
        workspaceKey: '/workspace',
        ownerKey: 'local:test',
        transientTabSeed: {
          title: '网站账号草稿',
          icon: '🌐',
          initialUrl: 'https://example.com/current',
          browserProfile: 'draft-profile',
        },
      }),
    )
  })
})
