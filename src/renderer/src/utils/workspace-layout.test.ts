import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@shared/ipc/settings'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import {
  globalWorkspaceRef,
  localWorkspaceRef,
  remoteWorkspaceRef,
  workspaceRefKey,
  type WorkspaceRef,
} from '@shared/workspace-ref'
import {
  captureWorkspaceLayout,
  createWorkspaceLayoutRestore,
  normalizeWorkspaceLayout,
  persistCapturedWorkspaceLayout,
  UI_DEFAULTS,
  useUIStore,
} from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import {
  restoreWorkspaceState,
  type WorkspaceBootstrapDeps,
} from '../bootstrap/workspace-bootstrap-core'
import {
  applyWorkspaceRuntimeTransition,
  prepareWorkspaceRuntimeTransition,
} from './workspace-transition'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  flushPendingWorkspaceStateWrites,
  isWorkspaceStateRestoring,
  setWorkspaceStateOwnerKey,
} from './workspace-state'
import { clampPanelWidth, getAgentPanelWidthBounds } from './panel-layout'
import { cancelActivePanelResize, registerPanelResizeCancel } from './panel-layout-drag-lifecycle'
import {
  getRendererDiagnosticLogSnapshot,
  resetRendererDiagnosticsForTest,
} from '../features/diagnostics/renderer-diagnostic-log'

const a = localWorkspaceRef('/workspace/a')
const b = localWorkspaceRef('/workspace/b')
const c = localWorkspaceRef('/workspace/c')
const layoutA = normalizeWorkspaceLayout({
  sidebarWidth: 180,
  agentPanelWidth: 260,
  sidebarVisible: false,
  agentPanelMode: 'right',
  agentPanelModeSource: 'user',
})
const layoutB = normalizeWorkspaceLayout({
  sidebarWidth: 420,
  agentPanelWidth: 600,
  agentPanelMode: 'hidden',
  agentPanelModeSource: 'user',
})
const legacyKey = 'cclink-studio-ui-state'
const snapshots = new Map<string | null, Record<string, unknown>>()
const legacy = new Map<string, string>()

function snapshot(key: string | null): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: key ?? 'global',
    workspaceKey: key,
    workspacePath: key,
    ownerKey: 'owner-a',
    updatedAt: 1,
    sections: structuredClone(snapshots.get(key) ?? {}),
  }
}

async function switchTo(ref: WorkspaceRef): Promise<boolean> {
  return applyWorkspaceRuntimeTransition(await prepareWorkspaceRuntimeTransition(ref), {
    flush: false,
  })
}

function bootstrapDeps(): WorkspaceBootstrapDeps {
  return {
    getSettings: async () => ({ lastWorkspacePath: a.path }) as AppSettings,
    resolveWorkspacePath: async (path) => path,
    initWorkspace: async (path) => {
      useWorkspaceStore
        .getState()
        .commitActiveWorkspace(path ? localWorkspaceRef(path) : globalWorkspaceRef())
      return path
    },
    setWorkspacePath: () => {},
    getWorkspaceState: async (path) => window.cclinkStudio.workspaceState.get(path),
    beginRestore: beginWorkspaceStateRestore,
    endRestore: endWorkspaceStateRestore,
    hydrateLayout: (value) => useUIStore.getState().hydrateFromWorkspaceState(value),
    createLayoutRestore: createWorkspaceLayoutRestore,
    hydrateBrowserTabs: () => {},
    hydrateTabs: () => {},
    hydrateEditorDrafts: () => {},
    hydrateFileTree: () => {},
    hydrateAgentConversations: () => {},
    refreshWorkspace: async () => {},
    warn: vi.fn(),
  }
}

beforeEach(() => {
  snapshots.clear()
  legacy.clear()
  resetRendererDiagnosticsForTest()
  beginWorkspaceStateRestore()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useTabStore.setState(useTabStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(a)
  setWorkspaceStateOwnerKey('owner-a')
  endWorkspaceStateRestore()
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: {
        get: vi.fn(async (key: string | null) => snapshot(key)),
        setActiveLocalWorkspace: vi.fn(async () => ({ success: true })),
        setSection: vi.fn(async (key: string | null, section: string, value: unknown) => {
          snapshots.set(key, { ...snapshots.get(key), [section]: structuredClone(value) })
          return { success: true }
        }),
      },
      browser: { reconcileViews: vi.fn(async () => {}) },
      terminal: { listSessions: vi.fn(async () => []) },
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => legacy.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => legacy.set(key, value)),
    removeItem: vi.fn((key: string) => legacy.delete(key)),
  })
})

afterEach(async () => {
  cancelActivePanelResize()
  await flushPendingWorkspaceStateWrites()
  vi.unstubAllGlobals()
  setWorkspaceStateOwnerKey(null)
})

describe('workspace layout integration', () => {
  it('waits for A layout writes made while B commits before reading A on a rapid return', async () => {
    const original = normalizeWorkspaceLayout({ sidebarWidth: 200, agentPanelModeSource: 'user' })
    snapshots.set(a.path, { layout: original })
    snapshots.set(b.path, { layout: layoutB })
    beginWorkspaceStateRestore()
    useUIStore.getState().hydrateFromWorkspaceState(original)
    endWorkspaceStateRestore()
    const preparedB = await prepareWorkspaceRuntimeTransition(b)
    let acknowledgeB: (() => void) | undefined
    vi.mocked(window.cclinkStudio.workspaceState.setActiveLocalWorkspace).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledgeB = () => resolve({ success: true })
        }),
    )
    const committingB = applyWorkspaceRuntimeTransition(preparedB, { flush: false })
    await vi.waitFor(() => expect(acknowledgeB).toBeTypeOf('function'))
    let finishAWrite: (() => void) | undefined
    const write = vi.mocked(window.cclinkStudio.workspaceState.setSection)
    const realWrite = write.getMockImplementation()!
    write.mockImplementation(async (key, section, value, owner) => {
      if (key === a.path && section === 'layout') {
        await new Promise<void>((resolve) => {
          finishAWrite = resolve
        })
        write.mockImplementation(realWrite)
      }
      return realWrite(key, section, value, owner)
    })
    useUIStore.getState().setSidebarWidth(300)
    await vi.waitFor(() => expect(finishAWrite).toBeTypeOf('function'))
    const read = vi.mocked(window.cclinkStudio.workspaceState.get)
    try {
      acknowledgeB!()
      expect(await committingB).toBe(true)
      expect(useUIStore.getState()).toMatchObject(layoutB)
      expect(snapshots.get(a.path)?.layout).toMatchObject({ sidebarWidth: 200 })
      read.mockClear()
      const returningA = switchTo(a)
      // 让无需等待的 B 保存及 Promise 回调全部执行；A 的布局写入仍被显式阻塞。
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const readsBeforeWriteFinishes = read.mock.calls.filter(([key]) => key === a.path).length
      finishAWrite!()
      expect(await returningA).toBe(true)
      useUIStore.getState().hideSidebar()
      await flushPendingWorkspaceStateWrites()
      expect(readsBeforeWriteFinishes).toBe(0)
      expect(useUIStore.getState()).toMatchObject({ sidebarWidth: 300, sidebarVisible: false })
      expect(snapshots.get(a.path)?.layout).toMatchObject({
        sidebarWidth: 300,
        sidebarVisible: false,
      })
    } finally {
      acknowledgeB!()
      finishAWrite!()
      await flushPendingWorkspaceStateWrites()
    }
  })

  it('preserves edits made while main commits a reopen of the current workspace', async () => {
    const original = normalizeWorkspaceLayout({ sidebarWidth: 200, agentPanelModeSource: 'user' })
    snapshots.set(a.path, { layout: original })
    beginWorkspaceStateRestore()
    useUIStore.getState().hydrateFromWorkspaceState(original)
    endWorkspaceStateRestore()
    let acknowledgeCommit: (() => void) | undefined
    vi.mocked(window.cclinkStudio.workspaceState.setActiveLocalWorkspace).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledgeCommit = () => resolve({ success: true })
        }),
    )
    const reopening = switchTo(a)
    await vi.waitFor(() => expect(acknowledgeCommit).toBeTypeOf('function'))
    useUIStore.getState().setSidebarWidth(300)
    await flushPendingWorkspaceStateWrites()
    acknowledgeCommit!()
    expect(await reopening).toBe(true)
    useUIStore.getState().hideSidebar()
    await flushPendingWorkspaceStateWrites()
    expect(useUIStore.getState()).toMatchObject({ sidebarWidth: 300, sidebarVisible: false })
    expect(snapshots.get(a.path)?.layout).toMatchObject({
      sidebarWidth: 300,
      sidebarVisible: false,
    })
  })

  it('cancels a drag started during preparation at commit, while stale requests cannot cancel a newer drag', async () => {
    const prepared = await prepareWorkspaceRuntimeTransition(b, { persistCurrent: false })
    const outgoingDrag = vi.fn()
    registerPanelResizeCancel(outgoingDrag)
    expect(await applyWorkspaceRuntimeTransition(prepared, { flush: false })).toBe(true)
    expect(outgoingDrag).toHaveBeenCalledOnce()
    await switchTo(c)
    const currentDrag = vi.fn()
    registerPanelResizeCancel(currentDrag)
    expect(await applyWorkspaceRuntimeTransition(prepared)).toBe(false)
    expect(currentDrag).not.toHaveBeenCalled()
  })

  it('restores A → B → A and never writes a restored snapshot from inside the guard', async () => {
    snapshots.set(b.path, { layout: layoutB })
    useUIStore.setState(layoutA)
    await flushPendingWorkspaceStateWrites()
    const setSection = vi.mocked(window.cclinkStudio.workspaceState.setSection)
    setSection.mockClear()
    expect(await switchTo(b)).toBe(true)
    expect(useUIStore.getState()).toMatchObject(layoutB)
    expect(
      setSection.mock.calls.filter(([key, section]) => key === b.path && section === 'layout'),
    ).toEqual([])
    expect(await switchTo(a)).toBe(true)
    expect(useUIStore.getState()).toMatchObject(layoutA)
    expect(snapshots.get(a.path)?.layout).toEqual(layoutA)
  })

  it('uses complete defaults for a workspace with no layout', async () => {
    useUIStore.setState(layoutB)
    expect(await switchTo(c)).toBe(true)
    expect(useUIStore.getState()).toMatchObject(UI_DEFAULTS)
  })

  it('isolates local, remote and global using the existing WorkspaceRef keys', async () => {
    const remote = remoteWorkspaceRef({
      endpointId: 'endpoint-a',
      workspaceId: 'remote-a',
      path: '/srv/a',
    })
    const global = globalWorkspaceRef()
    const layouts = [
      layoutA,
      layoutB,
      normalizeWorkspaceLayout({
        sidebarWidth: 300,
        agentPanelWidth: 450,
        agentPanelMode: 'center',
        agentPanelModeSource: 'user',
      }),
    ]
    const refs = [a, remote, global]
    for (let i = 0; i < refs.length; i++) {
      expect(await switchTo(refs[i]!)).toBe(true)
      useUIStore.setState(layouts[i]!)
      await flushPendingWorkspaceStateWrites()
    }
    for (let i = refs.length - 1; i >= 0; i--) {
      expect(await switchTo(refs[i]!)).toBe(true)
      expect(useUIStore.getState()).toMatchObject(layouts[i]!)
      expect(snapshots.get(workspaceRefKey(refs[i]!))?.layout).toEqual(layouts[i])
    }
  })

  it('rejects a late B layout after C has committed', async () => {
    snapshots.set(b.path, { layout: layoutB })
    snapshots.set(c.path, { layout: layoutA })
    let resolveB!: (value: WorkspaceStateSnapshot) => void
    vi.mocked(window.cclinkStudio.workspaceState.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = resolve
        }),
    )
    const pendingB = prepareWorkspaceRuntimeTransition(b, { persistCurrent: false })
    expect(await switchTo(c)).toBe(true)
    resolveB(snapshot(b.path))
    expect(await applyWorkspaceRuntimeTransition(await pendingB)).toBe(false)
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(c)
    expect(useUIStore.getState()).toMatchObject(layoutA)
  })

  it('writes only the immutable captured A snapshot and owner after B becomes current', async () => {
    beginWorkspaceStateRestore()
    useUIStore.setState(layoutA)
    endWorkspaceStateRestore()
    const captured = captureWorkspaceLayout()
    useWorkspaceStore.getState().commitActiveWorkspace(b)
    setWorkspaceStateOwnerKey('owner-b')
    useUIStore.setState(layoutB)
    await persistCapturedWorkspaceLayout(captured)
    expect(captured.snapshot).toEqual(layoutA)
    expect(Object.isFrozen(captured.snapshot)).toBe(true)
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenCalledWith(
      a.path,
      'layout',
      layoutA,
      'owner-a',
    )
    expect(snapshots.get(a.path)?.layout).toEqual(layoutA)
    expect(snapshots.get(b.path)?.layout).toEqual(layoutB)
  })

  it('continues switching after layout persistence fails and restores the last successful value', async () => {
    snapshots.set(a.path, { layout: layoutA })
    snapshots.set(b.path, { layout: layoutB })
    const write = vi.mocked(window.cclinkStudio.workspaceState.setSection)
    const realWrite = write.getMockImplementation()!
    write.mockImplementation((key, section, value, owner) =>
      section === 'layout'
        ? Promise.resolve({
            success: false,
            error: 'disk unavailable',
            errorCode: 'workspace_flush_failed',
          })
        : realWrite(key, section, value, owner),
    )
    useUIStore.getState().setSidebarWidth(330)
    await flushPendingWorkspaceStateWrites()
    expect(await switchTo(b)).toBe(true)
    expect(useUIStore.getState()).toMatchObject(layoutB)
    expect(await switchTo(a)).toBe(true)
    expect(useUIStore.getState()).toMatchObject(layoutA)
    expect(
      getRendererDiagnosticLogSnapshot().entries.some((entry) =>
        entry.message.includes('persistence-failed'),
      ),
    ).toBe(true)
  })

  it('does not persist viewport clamp and keeps restored user mode above system context', async () => {
    useUIStore.setState(layoutB)
    const displayed = (width: number): number =>
      clampPanelWidth(
        useUIStore.getState().agentPanelWidth,
        getAgentPanelWidthBounds({ viewportWidth: width, sidebarVisible: true, sidebarWidth: 420 }),
      )
    expect(displayed(1600)).toBe(600)
    expect(displayed(800)).toBe(220)
    expect(displayed(1600)).toBe(600)
    useUIStore.getState().applySystemWorkContext('empty')
    useUIStore.getState().applySystemWorkContext('browser')
    await flushPendingWorkspaceStateWrites()
    expect(useUIStore.getState()).toMatchObject(layoutB)
    expect(snapshots.get(a.path)?.layout).toEqual(layoutB)
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})

describe('startup layout and one-time legacy migration', () => {
  it('restores persisted layout on a fresh bootstrap without using the legacy global value', async () => {
    snapshots.set(a.path, { layout: layoutA })
    legacy.set(legacyKey, JSON.stringify(layoutB))
    await restoreWorkspaceState(bootstrapDeps())
    expect(useUIStore.getState()).toMatchObject(layoutA)
    expect(snapshots.get(a.path)?.layout).toEqual(layoutA)
    expect(legacy.has(legacyKey)).toBe(false)
    expect(
      vi
        .mocked(window.cclinkStudio.workspaceState.setSection)
        .mock.calls.filter(([, section]) => section === 'layout'),
    ).toEqual([])
  })

  it('writes legacy only to the captured startup target outside the guard and deletes only after success', async () => {
    legacy.set(legacyKey, JSON.stringify(layoutB))
    let finish!: () => void
    vi.mocked(window.cclinkStudio.workspaceState.setSection).mockImplementationOnce(
      async (key, section, value, owner) => {
        expect(isWorkspaceStateRestoring()).toBe(false)
        expect([key, section, value, owner]).toEqual([a.path, 'layout', layoutB, 'owner-a'])
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        snapshots.set(key ?? null, { layout: value })
        return { success: true }
      },
    )
    const boot = restoreWorkspaceState(bootstrapDeps())
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(legacy.has(legacyKey)).toBe(true)
    finish()
    await boot
    expect(legacy.has(legacyKey)).toBe(false)
    expect(snapshots.get(a.path)?.layout).toEqual(layoutB)
    expect(snapshots.has(b.path)).toBe(false)
  })

  it('retains legacy on failed writes and retries on the next startup', async () => {
    legacy.set(legacyKey, JSON.stringify(layoutB))
    vi.mocked(window.cclinkStudio.workspaceState.setSection).mockResolvedValueOnce({
      success: false,
      error: 'disk unavailable',
    })
    await restoreWorkspaceState(bootstrapDeps())
    expect(legacy.has(legacyKey)).toBe(true)
    expect(snapshots.get(a.path)?.layout).toBeUndefined()
    await restoreWorkspaceState(bootstrapDeps())
    expect(legacy.has(legacyKey)).toBe(false)
    expect(snapshots.get(a.path)?.layout).toEqual(layoutB)
  })

  it('uses defaults for an existing invalid layout, without filling from legacy', async () => {
    snapshots.set(a.path, { layout: null })
    legacy.set(legacyKey, JSON.stringify(layoutB))
    await restoreWorkspaceState(bootstrapDeps())
    expect(useUIStore.getState()).toMatchObject(UI_DEFAULTS)
    expect(snapshots.get(a.path)?.layout).toBe(null)
  })

  it('does not let a late bootstrap layout or migration overwrite a newer target', async () => {
    legacy.set(legacyKey, JSON.stringify(layoutA))
    let read!: (value: WorkspaceStateSnapshot) => void
    vi.mocked(window.cclinkStudio.workspaceState.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          read = resolve
        }),
    )
    const boot = restoreWorkspaceState(bootstrapDeps())
    await vi.waitFor(() => expect(read).toBeTypeOf('function'))
    useWorkspaceStore.getState().commitActiveWorkspace(b)
    useUIStore.setState(layoutB)
    read(snapshot(a.path))
    await boot
    expect(useUIStore.getState()).toMatchObject(layoutB)
    expect(snapshots.get(a.path)?.layout).toBeUndefined()
    expect(legacy.has(legacyKey)).toBe(true)
  })

  it('retains legacy if any restore stage fails', async () => {
    legacy.set(legacyKey, JSON.stringify(layoutA))
    const deps = bootstrapDeps()
    deps.hydrateTabs = () => {
      throw new Error('restore failed')
    }
    expect((await restoreWorkspaceState(deps)).canPersistRuntime).toBe(false)
    expect(legacy.has(legacyKey)).toBe(true)
    expect(snapshots.get(a.path)?.layout).toBeUndefined()
  })
})
