import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchWindowStore } from './workbench-window-store'

describe('workbench window store', () => {
  beforeEach(() => useWorkbenchWindowStore.setState({ placements: {} }))

  it('does not let a stale projection overwrite a newer placement event', () => {
    useWorkbenchWindowStore.getState().applyPlacement({
      tabId: 'browser-1',
      workspaceKey: '/workspace-a',
      windowId: 'main',
      generation: 4,
      state: 'attached',
      active: true,
    })
    useWorkbenchWindowStore.getState().hydratePlacements([
      {
        tabId: 'browser-1',
        workspaceKey: '/workspace-a',
        windowId: 'aux-old',
        generation: 2,
        state: 'attached',
        active: true,
      },
    ])

    expect(useWorkbenchWindowStore.getState().placements['browser-1']).toMatchObject({
      windowId: 'main',
      generation: 4,
    })
  })
})
