import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommandStore } from '../../stores/command-store'
import { useContextMenuStore } from './context-menu-store'
import { useContextActionDiagnosticsStore } from './context-action-diagnostics'
import { resolveMenuContributions, type MenuContribution } from './menu-contribution-registry'
import { findBoundaryEnabledIndex, findNextEnabledIndex, fitMenuPosition } from './menu-position'

beforeEach(() => {
  useCommandStore.setState({
    commands: [],
    paletteOpen: false,
    query: '',
    recentCommandIds: [],
  })
  useContextMenuStore.setState({
    open: false,
    menuId: 0,
    x: 0,
    y: 0,
    target: null,
    focusReturn: null,
    browserPreviewDataUrl: null,
    workspaceKeyAtOpen: null,
    editingContributionId: null,
    inputValue: '',
  })
  useContextActionDiagnosticsStore.getState().clear()
})

describe('context command execution', () => {
  it('passes the structured target and input through the central executor', async () => {
    const action = vi.fn()
    useCommandStore.getState().registerCommand({
      id: 'test.rename',
      label: 'Rename',
      contextOnly: true,
      enabled: (context) => context.target?.kind === 'tab',
      action,
    })
    const context = {
      source: 'context-menu' as const,
      target: { kind: 'tab' as const, workspaceKey: null, tabId: 'tab-1', tabType: 'editor' },
      inputValue: 'Draft',
    }

    await expect(
      useCommandStore.getState().executeCommand('test.rename', context),
    ).resolves.toEqual({
      ok: true,
    })
    expect(action).toHaveBeenCalledWith(context)
    expect(useCommandStore.getState().getFilteredCommands()).toEqual([])
  })

  it('rejects disabled commands before invoking their action', async () => {
    const action = vi.fn()
    useCommandStore.getState().registerCommand({
      id: 'test.disabled',
      label: 'Disabled',
      enabled: () => ({ enabled: false, reason: 'stale target' }),
      action,
    })

    await expect(
      useCommandStore.getState().executeCommand('test.disabled', { source: 'palette' }),
    ).resolves.toEqual({ ok: false, reason: 'disabled', message: 'stale target' })
    expect(action).not.toHaveBeenCalled()
  })

  it('rejects stale workspace targets before invoking their action', async () => {
    const action = vi.fn()
    useCommandStore.getState().registerCommand({ id: 'test.stale', label: 'Stale', action })

    await expect(
      useCommandStore.getState().executeCommand('test.stale', {
        source: 'context-menu',
        target: { kind: 'tab', workspaceKey: '/old', tabId: 'tab-1', tabType: 'editor' },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'stale-target',
      message: '操作目标所属项目已切换',
    })
    expect(action).not.toHaveBeenCalled()
    expect(useContextActionDiagnosticsStore.getState().events).toMatchObject([
      {
        kind: 'stale-target',
        commandId: 'test.stale',
        targetKind: 'tab',
        message: '操作目标所属项目已切换',
      },
    ])
  })
})

describe('menu composition and lifetime', () => {
  it('filters by target and condition, then orders by group and order', () => {
    const contributions: MenuContribution[] = [
      { id: 'late', targetKinds: ['tab'], group: '20-edit', order: 20, commandId: 'late' },
      { id: 'file', targetKinds: ['file'], group: '10-open', order: 10, commandId: 'file' },
      { id: 'first', targetKinds: ['tab'], group: '10-open', order: 10, commandId: 'first' },
      {
        id: 'hidden',
        targetKinds: ['tab'],
        group: '10-open',
        order: 20,
        commandId: 'hidden',
        when: () => false,
      },
    ]
    const context = {
      source: 'context-menu' as const,
      target: { kind: 'tab' as const, workspaceKey: '/project', tabId: 'tab-1', tabType: 'editor' },
    }

    expect(resolveMenuContributions(contributions, context).map((item) => item.id)).toEqual([
      'first',
      'late',
    ])
  })

  it('replaces the current menu instead of allowing two owners', () => {
    const store = useContextMenuStore.getState()
    store.show({
      target: { kind: 'file', workspaceKey: '/a', path: '/a/a.md', name: 'a.md', fileType: 'file' },
      x: 10,
      y: 20,
    })
    const firstMenuId = useContextMenuStore.getState().menuId
    store.show({
      target: { kind: 'project', workspaceKey: '/b', path: '/b' },
      x: 30,
      y: 40,
    })

    expect(useContextMenuStore.getState()).toMatchObject({
      open: true,
      x: 30,
      y: 40,
      target: { kind: 'project', path: '/b' },
    })
    expect(useContextMenuStore.getState().menuId).toBeGreaterThan(firstMenuId)
  })
})

describe('menu positioning', () => {
  it('keeps the menu inside every viewport edge', () => {
    expect(
      fitMenuPosition({
        x: 990,
        y: 790,
        menuWidth: 220,
        menuHeight: 300,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 772, top: 492 })
    expect(
      fitMenuPosition({
        x: -20,
        y: -10,
        menuWidth: 220,
        menuHeight: 300,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 8, top: 8 })
  })

  it('navigates around disabled items and wraps at both ends', () => {
    const enabled = [false, true, false, true]
    expect(findNextEnabledIndex(enabled, 1, 1)).toBe(3)
    expect(findNextEnabledIndex(enabled, 3, 1)).toBe(1)
    expect(findNextEnabledIndex(enabled, 1, -1)).toBe(3)
    expect(findBoundaryEnabledIndex(enabled, 'start')).toBe(1)
    expect(findBoundaryEnabledIndex(enabled, 'end')).toBe(3)
  })
})
