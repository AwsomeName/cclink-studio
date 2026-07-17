import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProjectCloseSuccessor,
  normalizeOpenProjectPaths,
  reorderOpenProjectPaths,
  resetOpenProjectsBootstrapForTests,
  restoreOpenProjects,
  useOpenProjectsStore,
} from './open-projects-store'
import { setWorkspaceStateOwnerKey } from '../utils/workspace-state'

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
        version: 1,
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
        version: 1,
        openProjectPaths: ['/workspace/a', '/workspace/b', '/workspace/c'],
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
        version: 1,
        openProjectPaths: ['/workspace/a', '/workspace/b'],
      },
      null,
    )
  })
})
