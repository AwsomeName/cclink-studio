import { describe, expect, it, vi } from 'vitest'
import { WorkbenchTabModel, WorkbenchTabModelError } from './workbench-tab-model'
import { BrowserBookmarkModel } from './browser-bookmark-model'

describe('WorkbenchTabModel', () => {
  it('loads the legacy tabs section and becomes its single delta writer', async () => {
    const workspaceState = createWorkspaceState({
      tabs: [{ id: 'browser-1', type: 'browser', title: 'One', icon: 'globe' }],
      activeTabId: 'browser-1',
    })
    const model = new WorkbenchTabModel(workspaceState as never)
    const initial = await model.getProjection('/workspace-a')

    expect(initial).toMatchObject({ revision: 0, activeTabId: 'browser-1' })
    const updated = await model.applyDelta({
      workspaceKey: '/workspace-a',
      ownerKey: null,
      expectedRevision: 0,
      upserts: [
        { id: 'browser-1', type: 'browser', title: 'Renamed', icon: 'globe' },
        { id: 'editor-1', type: 'editor', title: 'Draft', icon: 'file' },
      ],
      removedTabIds: [],
      orderedTabIds: ['editor-1', 'browser-1'],
      activeTabId: 'editor-1',
    })

    expect(updated).toMatchObject({ revision: 1, activeTabId: 'editor-1' })
    expect(workspaceState.setSection).toHaveBeenCalledWith(
      '/workspace-a',
      'tabs',
      {
        tabs: [
          expect.objectContaining({ id: 'editor-1' }),
          expect.objectContaining({ id: 'browser-1', title: 'Renamed' }),
        ],
        activeTabId: 'editor-1',
      },
      null,
    )
  })

  it('rejects stale revisions and incomplete order without writing', async () => {
    const workspaceState = createWorkspaceState({
      tabs: [{ id: 'browser-1', type: 'browser', title: 'One', icon: 'globe' }],
      activeTabId: 'browser-1',
    })
    const model = new WorkbenchTabModel(workspaceState as never)
    await model.getProjection('/workspace-a')

    await expect(
      model.applyDelta({
        workspaceKey: '/workspace-a',
        ownerKey: null,
        expectedRevision: 1,
        upserts: [],
        removedTabIds: [],
        orderedTabIds: ['browser-1'],
        activeTabId: 'browser-1',
      }),
    ).rejects.toMatchObject({ code: 'stale-revision' })
    await expect(
      model.applyDelta({
        workspaceKey: '/workspace-a',
        ownerKey: null,
        expectedRevision: 0,
        upserts: [{ id: 'editor-1', type: 'editor', title: 'Draft', icon: 'file' }],
        removedTabIds: [],
        orderedTabIds: ['browser-1'],
        activeTabId: 'browser-1',
      }),
    ).rejects.toMatchObject({ code: 'invalid-delta' })
    expect(workspaceState.setSection).not.toHaveBeenCalled()
  })

  it('does not publish an in-memory revision when persistence fails', async () => {
    const workspaceState = createWorkspaceState({ tabs: [], activeTabId: null })
    workspaceState.setSection.mockRejectedValueOnce(new Error('disk full'))
    const model = new WorkbenchTabModel(workspaceState as never)

    await expect(
      model.applyDelta({
        workspaceKey: '/workspace-a',
        ownerKey: null,
        expectedRevision: 0,
        upserts: [{ id: 'browser-1', type: 'browser', title: 'One', icon: 'globe' }],
        removedTabIds: [],
        orderedTabIds: ['browser-1'],
        activeTabId: 'browser-1',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkbenchTabModelError>>({ code: 'persist-failed' }),
    )

    expect(await model.getProjection('/workspace-a')).toMatchObject({ revision: 0, tabs: [] })
  })

  it('serializes concurrent deltas and makes the second stale instead of last-write-wins', async () => {
    const workspaceState = createWorkspaceState({ tabs: [], activeTabId: null })
    const model = new WorkbenchTabModel(workspaceState as never)
    const first = model.applyDelta({
      workspaceKey: '/workspace-a',
      ownerKey: null,
      expectedRevision: 0,
      upserts: [{ id: 'browser-1', type: 'browser', title: 'One', icon: 'globe' }],
      removedTabIds: [],
      orderedTabIds: ['browser-1'],
      activeTabId: 'browser-1',
    })
    const second = model.applyDelta({
      workspaceKey: '/workspace-a',
      ownerKey: null,
      expectedRevision: 0,
      upserts: [{ id: 'browser-2', type: 'browser', title: 'Two', icon: 'globe' }],
      removedTabIds: [],
      orderedTabIds: ['browser-2'],
      activeTabId: 'browser-2',
    })

    await expect(first).resolves.toMatchObject({ revision: 1 })
    await expect(second).rejects.toMatchObject({ code: 'stale-revision' })
    expect(workspaceState.setSection).toHaveBeenCalledTimes(1)
  })

  it('writes Browser restore projection without copying legacy bookmarks', async () => {
    const workspaceState = createWorkspaceState(
      { tabs: [], activeTabId: null },
      {
        tabs: { 'browser-1': browserProjection('https://old.example') },
        bookmarks: [bookmark('legacy')],
      },
    )
    const model = new WorkbenchTabModel(workspaceState as never)
    const initial = await model.getBrowserProjection('/workspace-a')

    expect(initial.tabs['browser-1']?.url).toBe('https://old.example')
    await model.applyBrowserDelta({
      workspaceKey: '/workspace-a',
      ownerKey: null,
      expectedRevision: 0,
      upserts: [{ tabId: 'browser-1', projection: browserProjection('https://new.example') }],
      removedTabIds: [],
    })
    expect(workspaceState.setSection).toHaveBeenCalledWith(
      '/workspace-a',
      'browserTabs',
      { tabs: { 'browser-1': browserProjection('https://new.example') } },
      null,
    )
  })

  it('migrates legacy bookmarks into the independent main-owned section', async () => {
    const workspaceState = createWorkspaceState(
      { tabs: [], activeTabId: null },
      { tabs: {}, bookmarks: [bookmark('legacy')] },
    )
    const model = new BrowserBookmarkModel(workspaceState as never)
    const initial = await model.getProjection('/workspace-a')
    expect(initial.bookmarks.map((item) => item.id)).toEqual(['legacy'])

    await model.replace({
      workspaceKey: '/workspace-a',
      ownerKey: null,
      expectedRevision: 0,
      bookmarks: [...initial.bookmarks, bookmark('new')],
    })
    expect(workspaceState.setSection).toHaveBeenCalledWith(
      '/workspace-a',
      'browserBookmarks',
      { bookmarks: [bookmark('legacy'), bookmark('new')] },
      null,
    )
  })

  it('keeps legacy bookmarks visible and retries when the first migration write fails', async () => {
    const workspaceState = createWorkspaceState(
      { tabs: [], activeTabId: null },
      { tabs: {}, bookmarks: [bookmark('legacy')] },
    )
    workspaceState.setSection.mockRejectedValueOnce(new Error('disk full'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = new BrowserBookmarkModel(workspaceState as never)

    await expect(model.getProjection('/workspace-a')).resolves.toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'legacy' })],
    })
    await expect(model.getProjection('/workspace-a')).resolves.toMatchObject({
      bookmarks: [expect.objectContaining({ id: 'legacy' })],
    })

    expect(workspaceState.setSection).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('does not resurrect legacy bookmarks after the independent section was cleared', async () => {
    const workspaceState = createWorkspaceState(
      { tabs: [], activeTabId: null },
      { tabs: {}, bookmarks: [bookmark('legacy')] },
      { bookmarks: [] },
    )
    const model = new BrowserBookmarkModel(workspaceState as never)

    await expect(model.getProjection('/workspace-a')).resolves.toMatchObject({ bookmarks: [] })
    expect(workspaceState.setSection).not.toHaveBeenCalled()
  })
})

function createWorkspaceState(
  tabsSection: unknown,
  browserTabs: unknown = { tabs: {} },
  browserBookmarks?: unknown,
) {
  return {
    getSnapshot: vi.fn(async () => ({
      sections: { tabs: tabsSection, browserTabs, browserBookmarks },
    })),
    setSection: vi.fn(async () => ({ sections: { tabs: tabsSection } })),
  }
}

function browserProjection(url: string) {
  return {
    url,
    urlInput: url,
    title: null,
    faviconUrl: null,
    viewMode: 'desktop' as const,
    zoomMode: 'fit' as const,
    zoomFactor: 1,
    history: [url],
    historyIndex: 0,
    ready: false,
  }
}

function bookmark(id: string) {
  return {
    id,
    url: `https://${id}.example`,
    title: id,
    faviconUrl: null,
    createdAt: 1,
  }
}
