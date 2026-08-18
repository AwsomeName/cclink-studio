import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { localWorkspaceRef, remoteWorkspaceRef } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useBrowserStore } from '../../stores/browser-store'
import { useBrowserTaskStore } from '../../stores/browser-task-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useEditorStore } from '../../stores/editor-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { setWorkspaceStateOwnerKey, setWorkspaceStatePath } from '../../utils/workspace-state'
import { beginWorkspaceRuntimeTransition } from '../../utils/workspace-transition'
import { openWorkspaceRef } from './workspace-open-controller'

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
  it('commits a confirmed remote ref through the shared transition and project strip owner', async () => {
    await expect(openWorkspaceRef(remoteA, { confirmedRemote: true })).resolves.toEqual(remoteA)

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual(remoteA)
    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([remoteA])
    expect(useUIStore.getState().activePanel).toBe('files')
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
