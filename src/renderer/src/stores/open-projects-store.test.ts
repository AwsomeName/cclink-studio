import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProjectCloseSuccessor,
  normalizeOpenProjectPaths,
  reorderOpenProjectPaths,
  resetOpenProjectsBootstrapForTests,
  restoreOpenProjects,
  useOpenProjectsStore,
} from './open-projects-store'
import {
  flushPendingWorkspaceStateWrites,
  setWorkspaceStateOwnerKey,
} from '../utils/workspace-state'

describe('open-projects-store', () => {
  beforeEach(() => {
    useOpenProjectsStore.setState(useOpenProjectsStore.getInitialState(), true)
    resetOpenProjectsBootstrapForTests()
    setWorkspaceStateOwnerKey('local:owner-1')
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          get: vi.fn().mockResolvedValue({
            sections: {
              projectStrip: {
                version: 1,
                openProjectPaths: ['/workspace/a', '/workspace/b'],
              },
            },
          }),
          resolveLocalWorkspace: vi.fn(async (path: string) => ({
            valid: path !== '/workspace/missing',
            workspacePath: path === '/workspace/missing' ? null : path,
          })),
          setSection: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setWorkspaceStateOwnerKey(null)
  })

  it('normalizes empty and duplicate project paths without changing their first-open order', () => {
    expect(
      normalizeOpenProjectPaths([' /workspace/a ', '', '/workspace/b', '/workspace/a']),
    ).toEqual(['/workspace/a', '/workspace/b'])
  })

  it('appends newly opened projects and does not reorder an existing project', () => {
    const store = useOpenProjectsStore.getState()
    store.hydrate(['/workspace/a', '/workspace/b'])
    store.addProject('/workspace/c')
    store.addProject('/workspace/a')

    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual([
      '/workspace/a',
      '/workspace/b',
      '/workspace/c',
    ])
    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([
      { kind: 'local', path: '/workspace/a' },
      { kind: 'local', path: '/workspace/c' },
    ])
  })

  it('forgets a missing local project without removing remote history', async () => {
    const remote = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-a',
      path: '/srv/a',
    }
    useOpenProjectsStore.setState({
      openProjectPaths: ['/workspace/missing', '/workspace/a'],
      openRemoteWorkspaceRefs: [remote],
      recentWorkspaceRefs: [
        { kind: 'local', path: '/workspace/missing' },
        remote,
        { kind: 'local', path: '/workspace/a' },
      ],
    })

    useOpenProjectsStore.getState().forgetLocalProject('/workspace/missing')
    await flushPendingWorkspaceStateWrites()

    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual(['/workspace/a'])
    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([remote])
    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([
      remote,
      { kind: 'local', path: '/workspace/a' },
    ])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenLastCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: ['/workspace/a'],
        openRemoteWorkspaceRefs: [remote],
        recentWorkspaceRefs: [remote, { kind: 'local', path: '/workspace/a' }],
      },
      null,
    )
  })

  it('replaces a restored remote reference with the Agent-confirmed opaque workspace identity', async () => {
    const store = useOpenProjectsStore.getState()
    const stale = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'studio-local-hash',
      path: '/srv/project',
    }
    const confirmed = { ...stale, workspaceId: 'ws_agent_canonical' }
    store.addRemoteProject(stale)

    store.replaceRemoteProject(stale, confirmed)
    await flushPendingWorkspaceStateWrites()

    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([confirmed])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenLastCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: [],
        openRemoteWorkspaceRefs: [confirmed],
        recentWorkspaceRefs: [confirmed],
      },
      null,
    )
  })

  it('reorders by insertion position instead of swapping two projects', () => {
    expect(
      reorderOpenProjectPaths(
        ['/workspace/a', '/workspace/b', '/workspace/c', '/workspace/d'],
        '/workspace/a',
        '/workspace/c',
        'after',
      ),
    ).toEqual(['/workspace/b', '/workspace/c', '/workspace/a', '/workspace/d'])
  })

  it('persists a manually reordered project list', () => {
    const store = useOpenProjectsStore.getState()
    store.hydrate(['/workspace/a', '/workspace/b', '/workspace/c'])
    store.reorderProject('/workspace/c', '/workspace/a', 'before')

    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual([
      '/workspace/c',
      '/workspace/a',
      '/workspace/b',
    ])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: ['/workspace/c', '/workspace/a', '/workspace/b'],
      },
      null,
    )
  })

  it('chooses the right neighbor before falling back to the left when closing', () => {
    const paths = ['/workspace/a', '/workspace/b', '/workspace/c']
    expect(getProjectCloseSuccessor(paths, '/workspace/b')).toBe('/workspace/c')
    expect(getProjectCloseSuccessor(paths, '/workspace/c')).toBe('/workspace/b')
    expect(getProjectCloseSuccessor(['/workspace/a'], '/workspace/a')).toBeNull()
  })

  it('restores the persisted order, drops missing projects, and appends the current project', async () => {
    const get = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    get.mockResolvedValue({
      sections: {
        projectStrip: {
          version: 1,
          openProjectPaths: ['/workspace/a', '/workspace/missing', '/workspace/b'],
        },
      },
    })

    await restoreOpenProjects('/workspace/c')

    expect(get).toHaveBeenCalledWith(null, null)
    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual([
      '/workspace/a',
      '/workspace/b',
      '/workspace/c',
    ])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: ['/workspace/a', '/workspace/b', '/workspace/c'],
        recentWorkspaceRefs: [
          { kind: 'local', path: '/workspace/c' },
          { kind: 'local', path: '/workspace/a' },
          { kind: 'local', path: '/workspace/b' },
        ],
      },
      null,
    )
  })

  it('migrates the legacy owner-scoped project list into the single global list', async () => {
    const get = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    get.mockResolvedValueOnce({ sections: {} }).mockResolvedValueOnce({
      sections: {
        projectStrip: {
          version: 1,
          openProjectPaths: ['/workspace/a', '/workspace/b'],
        },
      },
    })

    await restoreOpenProjects('/workspace/a')

    expect(get).toHaveBeenNthCalledWith(1, null, null)
    expect(get).toHaveBeenNthCalledWith(2, null, 'local:owner-1')
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: ['/workspace/a', '/workspace/b'],
        recentWorkspaceRefs: [
          { kind: 'local', path: '/workspace/a' },
          { kind: 'local', path: '/workspace/b' },
        ],
      },
      null,
    )
  })

  it('keeps a removed remote project in history and promotes it when reopened', async () => {
    const remoteA = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-a',
      path: '/srv/a',
    }
    const remoteB = { ...remoteA, workspaceId: 'workspace-b', path: '/srv/b' }
    const store = useOpenProjectsStore.getState()

    store.addRemoteProject(remoteA)
    store.addRemoteProject(remoteB)
    store.removeRemoteProject(remoteA)

    expect(useOpenProjectsStore.getState().openRemoteWorkspaceRefs).toEqual([remoteB])
    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([remoteB, remoteA])

    useOpenProjectsStore.getState().addRemoteProject(remoteA)
    await flushPendingWorkspaceStateWrites()
    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([remoteA, remoteB])
  })

  it('migrates open remote projects from version 1 into remote history', async () => {
    const remote = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-a',
      path: '/srv/a',
    }
    const get = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    get.mockResolvedValue({
      sections: {
        projectStrip: {
          version: 1,
          openProjectPaths: [],
          openRemoteWorkspaceRefs: [remote],
        },
      },
    })

    await restoreOpenProjects(null)
    await flushPendingWorkspaceStateWrites()

    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([remote])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenLastCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: [],
        openRemoteWorkspaceRefs: [remote],
        recentWorkspaceRefs: [remote],
      },
      null,
    )
  })

  it('recovers valid local history when the persisted v3 recent path is stale', async () => {
    const remote = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-a',
      path: '/srv/a',
    }
    const get = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    get.mockResolvedValue({
      sections: {
        projectStrip: {
          version: 3,
          openProjectPaths: [],
          recentWorkspaceRefs: [{ kind: 'local', path: '/workspace/missing' }, remote],
        },
      },
    })

    await restoreOpenProjects(null, ['/workspace/recovered'])
    await flushPendingWorkspaceStateWrites()

    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([
      { kind: 'local', path: '/workspace/recovered' },
      remote,
    ])
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenLastCalledWith(
      null,
      'projectStrip',
      {
        version: 3,
        openProjectPaths: [],
        recentWorkspaceRefs: [{ kind: 'local', path: '/workspace/recovered' }, remote],
      },
      null,
    )
  })

  it('keeps one recency order across local and remote workspaces', () => {
    const remote = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-a',
      path: '/srv/a',
    }
    const store = useOpenProjectsStore.getState()

    store.addProject('/workspace/a')
    store.addRemoteProject(remote)
    store.addProject('/workspace/b')
    store.addProject('/workspace/a')

    expect(useOpenProjectsStore.getState().recentWorkspaceRefs).toEqual([
      { kind: 'local', path: '/workspace/a' },
      { kind: 'local', path: '/workspace/b' },
      remote,
    ])
  })
})
