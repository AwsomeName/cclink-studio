import { describe, expect, it } from 'vitest'
import type { WorkbenchPlacementChanged } from '@shared/ipc/workbench-window'
import type { Tab } from '../types'
import { resolveMainWindowActiveTabId } from './use-workbench-window-events'

const workspaceRef = { kind: 'local', path: '/workspace-a' } as const

function tab(id: string, type: Tab['type'] = 'browser'): Tab {
  return { id, type, title: id, icon: '', workspaceRef }
}

function placement(tabId: string, windowId: string, active: boolean): WorkbenchPlacementChanged {
  return {
    tabId,
    workspaceKey: workspaceRef.path,
    windowId,
    generation: 3,
    state: 'attached',
    active,
  }
}

describe('resolveMainWindowActiveTabId', () => {
  it('keeps a Markdown selection when returned Browser placements still claim active', () => {
    const tabs = [tab('browser-a'), tab('browser-b'), tab('markdown', 'editor')]
    const placements = {
      'browser-a': placement('browser-a', 'main', true),
      'browser-b': placement('browser-b', 'main', true),
    }

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'markdown',
        placements,
        activeWorkspaceKey: workspaceRef.path,
      }),
    ).toBe('markdown')
  })

  it('activates a returned Browser only for the placement event that explicitly prefers it', () => {
    const tabs = [tab('browser'), tab('markdown', 'editor')]
    const placements = { browser: placement('browser', 'main', true) }

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'markdown',
        placements,
        activeWorkspaceKey: workspaceRef.path,
        preferredActiveTabId: 'browser',
      }),
    ).toBe('browser')

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'markdown',
        placements,
        activeWorkspaceKey: workspaceRef.path,
      }),
    ).toBe('markdown')
  })

  it('adopts the projected Browser once when its workspace is hydrated', () => {
    const tabs = [tab('browser'), tab('markdown', 'editor')]
    const placements = { browser: placement('browser', 'main', true) }

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'markdown',
        placements,
        activeWorkspaceKey: workspaceRef.path,
        preferProjectedActive: true,
      }),
    ).toBe('browser')
  })

  it('keeps the explicitly selected main-window Browser instead of another stale active placement', () => {
    const tabs = [tab('browser-a'), tab('browser-b')]
    const placements = {
      'browser-a': placement('browser-a', 'main', true),
      'browser-b': placement('browser-b', 'main', true),
    }

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'browser-b',
        placements,
        activeWorkspaceKey: workspaceRef.path,
      }),
    ).toBe('browser-b')
  })

  it('falls back only when the selected Tab belongs to another window', () => {
    const tabs = [tab('browser-detached'), tab('markdown', 'editor')]
    const placements = {
      'browser-detached': placement('browser-detached', 'aux-1', true),
    }

    expect(
      resolveMainWindowActiveTabId({
        tabs,
        activeTabId: 'browser-detached',
        placements,
        activeWorkspaceKey: workspaceRef.path,
      }),
    ).toBe('markdown')
  })

  it('does not invent a selection when the Tab model has none', () => {
    expect(
      resolveMainWindowActiveTabId({
        tabs: [tab('browser')],
        activeTabId: null,
        placements: { browser: placement('browser', 'main', true) },
        activeWorkspaceKey: workspaceRef.path,
      }),
    ).toBeNull()
  })
})
