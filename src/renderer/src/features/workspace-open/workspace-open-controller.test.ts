import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useBrowserStore } from '../../stores/browser-store'
import { useBrowserTaskStore } from '../../stores/browser-task-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useEditorStore } from '../../stores/editor-store'
import { useFsStore } from '../../stores/fs-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useTabStore } from '../../stores/tab-store'
import { normalizeWorkspaceLayout, useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  flushPendingWorkspaceStateWrites,
  setWorkspaceStateOwnerKey,
  setWorkspaceStatePath,
} from '../../utils/workspace-state'
import { beginWorkspaceRuntimeTransition } from '../../utils/workspace-transition'
import { openWorkspaceRef, pickLocalWorkspace } from './workspace-open-controller'

function snapshot(
  workspaceKey: string,
  sections: Record<string, unknown> = {},
): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: workspaceKey,
    ownerKey: null,
    workspaceKey,
    workspacePath: null,
    sections,
    updatedAt: Date.now(),
  }
}

const localRef = localWorkspaceRef('/workspace/local')
const remoteA = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-a',
  path: '/srv/a',
  label: 'A',
})
const remoteB = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-b',
  path: '/srv/b',
  label: 'B',
})

beforeEach(() => {
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: {
        get: vi.fn(async (workspaceKey: string) =>
          snapshot(workspaceKey, {
            tabs: { tabs: [], activeTabId: null },
            browserTabs: { tabs: {} },
            editorDrafts: { files: {} },
          }),
        ),
        setActiveLocalWorkspace: vi.fn(async () => ({ success: true })),
        setSection: vi.fn(async () => ({ success: true })),
        resolveLocalWorkspace: vi.fn(async (path: string) => ({
          valid: true,
          workspacePath: path,
        })),
      },
      fs: { readDir: vi.fn(async () => []), watchDir: vi.fn(async () => vi.fn()) },
      settings: { set: vi.fn(async () => ({ success: true })) },
      dialog: {
        showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/workspace/picked'] })),
      },
      browser: { reconcileViews: vi.fn(async () => undefined) },
      terminal: { listSessions: vi.fn(async () => []) },
      cclink: {
        openWorkspace: vi.fn(),
        listServers: vi.fn(),
      },
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useBrowserTaskStore.setState(useBrowserTaskStore.getInitialState(), true)
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useFsStore.setState(useFsStore.getInitialState(), true)
  useOpenProjectsStore.setState(useOpenProjectsStore.getInitialState(), true)
  useTabStore.setState(useTabStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(localRef)
  setWorkspaceStateOwnerKey('local:owner')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setWorkspaceStatePath(null)
  setWorkspaceStateOwnerKey(null)
})

describe('workspace-open-controller', () => {
  it('keeps the latest width when the picker reopens the current workspace during a pending layout write', async () => {
    await flushPendingWorkspaceStateWrites()
    let savedLayout = normalizeWorkspaceLayout({ sidebarWidth: 200, agentPanelModeSource: 'user' })
    beginWorkspaceStateRestore()
    useUIStore.getState().hydrateFromWorkspaceState(savedLayout)
    endWorkspaceStateRestore()
    useFsStore.setState({ workspacePath: localRef.path })
    vi.mocked(window.cclinkStudio.dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [localRef.path],
    })
    vi.mocked(window.cclinkStudio.workspaceState.get).mockImplementation(async () =>
      snapshot(localRef.path, { layout: structuredClone(savedLayout) }),
    )
    let releaseWrite: (() => void) | undefined
    let firstLayoutWrite = true
    vi.mocked(window.cclinkStudio.workspaceState.setSection).mockImplementation(
      async (_key, section, value) => {
        if (section === 'layout') {
          if (firstLayoutWrite) {
            firstLayoutWrite = false
            await new Promise<void>((resolve) => {
              releaseWrite = resolve
            })
          }
          savedLayout = normalizeWorkspaceLayout(value)
        }
        return { success: true }
      },
    )
    useUIStore.getState().setSidebarWidth(300)
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf('function'))
    try {
      await expect(pickLocalWorkspace()).resolves.toBe(true)
      // 磁盘仍是 200；打开完成后释放 300 写入，再执行一次会保存整个布局的真实 UI 操作。
      expect(savedLayout.sidebarWidth).toBe(200)
      releaseWrite!()
      await flushPendingWorkspaceStateWrites()
      expect(savedLayout.sidebarWidth).toBe(300)
      useUIStore.getState().hideSidebar()
      await flushPendingWorkspaceStateWrites()
      expect(useUIStore.getState()).toMatchObject({ sidebarWidth: 300, sidebarVisible: false })
      expect(savedLayout).toMatchObject({ sidebarWidth: 300, sidebarVisible: false })
      expect(useFsStore.getState()).toMatchObject({
        workspacePath: localRef.path,
        picking: false,
        loading: false,
        switchingPath: null,
      })
    } finally {
      releaseWrite!()
      await flushPendingWorkspaceStateWrites()
    }
  })

  it('preserves the restored layout after the complete local picker flow and persistence drain', async () => {
    const layout = {
      activePanel: 'browser',
      sidebarVisible: false,
      sidebarWidth: 420,
      agentPanelWidth: 600,
      agentPanelMode: 'hidden',
      agentPanelVisible: false,
      agentPanelLastVisibleMode: 'right',
      agentPanelModeSource: 'user',
    }
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getSnapshot.mockResolvedValueOnce(snapshot('/workspace/picked', { layout }))
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    await expect(pickLocalWorkspace()).resolves.toBe(true)
    await flushPendingWorkspaceStateWrites()
    expect(useFsStore.getState()).toMatchObject({
      workspacePath: '/workspace/picked',
      picking: false,
      loading: false,
      switchingPath: null,
    })
    expect(useUIStore.getState()).toMatchObject(layout)
    expect(
      setSection.mock.calls.filter(
        ([key, section]) => key === '/workspace/picked' && section === 'layout',
      ),
    ).toEqual([])
    // 完整流程之后的真实用户修改才产生目标 layout 写入。
    useUIStore.getState().setAgentPanelWidth(620)
    await flushPendingWorkspaceStateWrites()
    expect(setSection).toHaveBeenCalledWith(
      '/workspace/picked',
      'layout',
      { ...layout, agentPanelWidth: 620 },
      'local:owner',
    )
  })

  it('commits a confirmed remote ref without changing the restored tab or current layout', async () => {
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getSnapshot.mockResolvedValueOnce(
      snapshot('remote:agent-1:workspace-a', {
        layout: {
          activePanel: 'browser',
          sidebarVisible: false,
          sidebarWidth: 312,
          agentPanelMode: 'hidden',
          agentPanelVisible: false,
          agentPanelModeSource: 'user',
        },
        tabs: {
          tabs: [
            {
              id: 'tab-first',
              type: 'editor',
              title: 'First',
              icon: 'file',
              workspaceRef: remoteA,
            },
            {
              id: 'tab-restored',
              type: 'editor',
              title: 'Restored',
              icon: 'file',
              workspaceRef: remoteA,
            },
          ],
          activeTabId: 'tab-restored',
        },
        browserTabs: { tabs: {} },
        editorDrafts: { files: {} },
      }),
    )
    useUIStore.setState({
      activePanel: 'browser',
      sidebarVisible: false,
      sidebarWidth: 312,
      agentPanelMode: 'hidden',
      agentPanelVisible: false,
      agentPanelModeSource: 'user',
    })

    await expect(openWorkspaceRef(remoteA, { confirmedRemote: true })).resolves.toEqual(remoteA)

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(remoteA)
    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([remoteA])
    expect(useTabStore.getState().activeTabId).toBe('tab-restored')
    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'browser',
      sidebarVisible: false,
      sidebarWidth: 312,
      agentPanelMode: 'hidden',
      agentPanelVisible: false,
      agentPanelModeSource: 'user',
    })
  })

  it('rejects an older remote discovery generation so only the later selection commits', async () => {
    const staleGeneration = beginWorkspaceRuntimeTransition()
    const currentGeneration = beginWorkspaceRuntimeTransition()

    await expect(
      openWorkspaceRef(remoteA, { confirmedRemote: true, generation: staleGeneration }),
    ).rejects.toThrow('工作空间已发生变化')
    await expect(
      openWorkspaceRef(remoteB, { confirmedRemote: true, generation: currentGeneration }),
    ).resolves.toEqual(remoteB)

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(remoteB)
    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([remoteB])
  })

  it('preserves the current workspace when target state preparation fails', async () => {
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getSnapshot.mockRejectedValueOnce(new Error('state unavailable'))

    await expect(openWorkspaceRef(remoteA, { confirmedRemote: true })).rejects.toThrow(
      'state unavailable',
    )
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(localRef)
    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([])
  })

  it('refreshes a stale startup device projection once before failing over to UI', async () => {
    const openWorkspace = window.cclinkStudio.cclink.openWorkspace as ReturnType<typeof vi.fn>
    const listServers = window.cclinkStudio.cclink.listServers as ReturnType<typeof vi.fn>
    openWorkspace.mockRejectedValueOnce(new Error('远程设备不在线')).mockResolvedValueOnce({
      id: remoteA.workspaceId,
      path: remoteA.path,
      name: 'A',
      serverId: remoteA.endpointId,
      kind: 'directory',
      exists: true,
    })
    listServers.mockResolvedValue([
      {
        id: remoteA.endpointId,
        name: 'Agent A',
        hostname: 'agent-a',
        os: 'linux',
        status: 'online',
        agentVersion: '1.0.0',
        lastSeen: Date.now(),
        workspaces: [],
      },
    ])
    useCclinkStore.setState({
      initialized: true,
      service: { configured: true },
      session: { loggedIn: true, user: null },
      realtime: { state: 'online' },
    })

    await expect(openWorkspaceRef(remoteA)).resolves.toMatchObject(remoteA)
    expect(listServers).toHaveBeenCalledOnce()
    expect(openWorkspace).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toMatchObject(remoteA)
  })
})
