import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { useAgentStore } from './agent-store'
import { useBrowserStore } from './browser-store'
import { useEditorStore } from './editor-store'
import { useFsStore } from './fs-store'
import { useOpenProjectsStore } from './open-projects-store'
import { useTabStore } from './tab-store'
import { useWorkspaceStore } from './workspace-store'
import { setWorkspaceStateOwnerKey, setWorkspaceStatePath } from '../utils/workspace-state'

function snapshot(
  workspaceKey: string | null,
  sections: Record<string, unknown>,
): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: workspaceKey ?? 'global',
    ownerKey: null,
    workspaceKey,
    workspacePath: workspaceKey,
    sections,
    updatedAt: Date.now(),
  }
}

describe('fs-store workspace switching', () => {
  const localStorageData = new Map<string, string>()

  beforeEach(() => {
    localStorageData.clear()
    vi.stubGlobal('window', {
      cclinkStudio: {
        fs: {
          readDir: vi.fn().mockResolvedValue([]),
          isDirectory: vi.fn().mockResolvedValue(true),
          rename: vi.fn().mockResolvedValue(undefined),
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockResolvedValue(undefined),
          watchDir: vi.fn().mockResolvedValue(vi.fn()),
        },
        workspaceState: {
          resolveLocalWorkspace: vi.fn(async (path: string) => ({
            valid: true,
            workspacePath: path,
          })),
          get: vi.fn(),
          setSection: vi.fn().mockResolvedValue({ success: true }),
          listLocalWorkspaces: vi.fn().mockResolvedValue([]),
        },
        settings: {
          getAll: vi.fn().mockResolvedValue({ lastWorkspacePath: '', recentWorkspacePaths: [] }),
          set: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageData.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageData.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        localStorageData.delete(key)
      }),
      clear: vi.fn(() => localStorageData.clear()),
    })
    useAgentStore.setState(useAgentStore.getInitialState(), true)
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    useEditorStore.setState(useEditorStore.getInitialState(), true)
    useFsStore.setState(useFsStore.getInitialState(), true)
    useOpenProjectsStore.setState(useOpenProjectsStore.getInitialState(), true)
    useTabStore.setState(useTabStore.getInitialState(), true)
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    setWorkspaceStatePath(null)
    setWorkspaceStateOwnerKey('local:owner-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setWorkspaceStatePath(null)
    setWorkspaceStateOwnerKey(null)
  })

  it('re-enters a local project with the owner-scoped conversation snapshot', async () => {
    const workspacePath = '/Users/apple/project'
    const conversationId = 'agent-project-session'
    const ownerSnapshot = snapshot(workspacePath, {
      agentConversations: {
        conversations: {
          [conversationId]: {
            id: conversationId,
            title: '项目会话',
            surface: 'assistant-panel',
            runtime: {
              location: 'local',
              transport: 'local',
              backend: 'cclink-studio-agent',
              workspaceRef: { kind: 'local', path: workspacePath },
            },
            messages: [
              {
                id: 'msg-1',
                role: 'user',
                content: [{ type: 'text', text: '恢复项目里的这条消息' }],
                rawText: '恢复项目里的这条消息',
                timestamp: 1,
              },
            ],
            input: '',
            loading: false,
            backendState: 'connected',
            sessionId: 'claude-session-1',
            streamingMessageId: null,
            lastCost: null,
            scope: { kind: 'all' },
            mountedResources: [],
            mountedSkills: [],
            createdAt: 1,
            updatedAt: 2,
            archivedAt: null,
          },
        },
        conversationOrder: [conversationId],
        activeConversationId: conversationId,
      },
      tabs: { tabs: [], activeTabId: null },
      browserTabs: { tabs: {} },
      editorDrafts: { files: {} },
      fileTree: { expandedPaths: [], selectedPath: null },
    })

    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockImplementation((key: string | null, ownerKey?: string | null) => {
      if (key === workspacePath && ownerKey === 'local:owner-1') {
        return Promise.resolve(ownerSnapshot)
      }
      return Promise.resolve(snapshot(key, {}))
    })

    await useFsStore.getState().openRecentWorkspace(workspacePath)

    expect(getWorkspaceState).toHaveBeenCalledWith(workspacePath, 'local:owner-1')
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: workspacePath,
    })
    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual([workspacePath])
    expect(useAgentStore.getState().activeConversationId).toBe(conversationId)
    expect(useAgentStore.getState().messages.at(-1)?.rawText).toBe('恢复项目里的这条消息')
  })

  it('restores recent projects from last workspace and local fallback after restart', async () => {
    const lastWorkspacePath = '/Users/apple/current-project'
    const oldWorkspacePath = '/Users/apple/old-project'
    localStorageData.set('cclink-studio-recent-workspaces', JSON.stringify([oldWorkspacePath]))

    const getAll = window.cclinkStudio.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath,
      recentWorkspacePaths: [],
    })
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(lastWorkspacePath, {}))

    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([
      lastWorkspacePath,
      oldWorkspacePath,
    ])
    expect(window.cclinkStudio.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [lastWorkspacePath, oldWorkspacePath],
    })
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'cclink-studio-recent-workspaces',
      JSON.stringify([lastWorkspacePath, oldWorkspacePath]),
    )
  })

  it('keeps recent projects from local fallback when settings are empty', async () => {
    const oldWorkspacePath = '/Users/apple/old-project'
    localStorageData.set('cclink-studio-recent-workspaces', JSON.stringify([oldWorkspacePath]))

    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([oldWorkspacePath])
    expect(window.cclinkStudio.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [oldWorkspacePath],
    })
  })

  it('does not overwrite persisted recent projects with an empty startup merge', async () => {
    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([])
    expect(window.cclinkStudio.settings.set).not.toHaveBeenCalledWith({
      recentWorkspacePaths: [],
    })
  })

  it('recovers recent projects from workspace state summaries after restart', async () => {
    const currentWorkspacePath = '/Users/apple/current-project'
    const olderWorkspacePath = '/Users/apple/old-project'
    const getAll = window.cclinkStudio.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath: currentWorkspacePath,
      recentWorkspacePaths: [currentWorkspacePath],
    })
    const listLocalWorkspaces = window.cclinkStudio.workspaceState
      .listLocalWorkspaces as ReturnType<typeof vi.fn>
    listLocalWorkspaces.mockResolvedValue([
      {
        workspaceKey: olderWorkspacePath,
        workspacePath: olderWorkspacePath,
        ownerKey: 'local:owner-1',
        updatedAt: 2,
      },
    ])
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(currentWorkspacePath, {}))

    await useFsStore.getState().initWorkspace()

    expect(listLocalWorkspaces).toHaveBeenCalledWith('local:owner-1')
    expect(useFsStore.getState().recentWorkspacePaths).toEqual([
      currentWorkspacePath,
      olderWorkspacePath,
    ])
    expect(window.cclinkStudio.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [currentWorkspacePath, olderWorkspacePath],
    })
  })

  it('filters missing workspace-state summaries from recovered recent projects', async () => {
    const currentWorkspacePath = '/Users/apple/current-project'
    const missingWorkspacePath = '/Users/apple/deleted-smoke-project'
    const getAll = window.cclinkStudio.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath: currentWorkspacePath,
      recentWorkspacePaths: [currentWorkspacePath, missingWorkspacePath],
    })
    const listLocalWorkspaces = window.cclinkStudio.workspaceState
      .listLocalWorkspaces as ReturnType<typeof vi.fn>
    listLocalWorkspaces.mockResolvedValue([
      {
        workspaceKey: missingWorkspacePath,
        workspacePath: missingWorkspacePath,
        ownerKey: 'local:owner-1',
        updatedAt: 2,
      },
    ])
    const isDirectory = window.cclinkStudio.fs.isDirectory as ReturnType<typeof vi.fn>
    isDirectory.mockImplementation((path: string) => {
      return Promise.resolve(path !== missingWorkspacePath)
    })
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(currentWorkspacePath, {}))

    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([currentWorkspacePath])
    expect(window.cclinkStudio.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [currentWorkspacePath],
    })
  })

  it('clears stale project runtime when the last workspace path no longer opens', async () => {
    const missingWorkspacePath = '/Users/apple/missing-project'
    useWorkspaceStore.getState().activateLocalWorkspace(missingWorkspacePath)
    const staleConversationId = useAgentStore.getState().createConversation({ activate: true })
    useBrowserStore.getState().ensureTab('stale-browser', 'https://stale.example')
    useTabStore.getState().openTab({ type: 'browser', title: 'Stale', icon: '🌐' })
    useEditorStore.getState().initVirtualFile('virtual:stale', 'stale draft')

    const getAll = window.cclinkStudio.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [missingWorkspacePath],
    })
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockRejectedValue(new Error('ENOENT'))
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockImplementation((key: string | null) => {
      if (key === null) {
        return Promise.resolve(
          snapshot(null, {
            tabs: { tabs: [], activeTabId: null },
            browserTabs: { tabs: {} },
            editorDrafts: { files: {} },
            agentConversations: {
              conversations: {},
              conversationOrder: [],
              activeConversationId: null,
            },
            fileTree: { expandedPaths: [], selectedPath: null },
          }),
        )
      }
      return Promise.resolve(
        snapshot(key, {
          fileTree: { expandedPaths: [missingWorkspacePath], selectedPath: missingWorkspacePath },
        }),
      )
    })

    await useFsStore.getState().initWorkspace()

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({ kind: 'global' })
    expect(useFsStore.getState().workspacePath).toBeNull()
    expect(useTabStore.getState().tabs).toEqual([])
    expect(useBrowserStore.getState().tabs).toEqual({})
    expect(useEditorStore.getState().files).toEqual({})
    expect(useAgentStore.getState().activeConversationId).not.toBe(staleConversationId)
    expect(window.cclinkStudio.settings.set).toHaveBeenCalledWith({ lastWorkspacePath: '' })
  })

  it('refreshes root tree after renaming a root-level file', async () => {
    const workspacePath = '/Users/apple/project'
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockResolvedValueOnce([
      {
        name: 'a',
        path: `${workspacePath}/a`,
        type: 'file',
        size: 0,
        modifiedAt: 1,
      },
    ])
    readDir.mockResolvedValueOnce([
      {
        name: '05-c c lin k',
        path: `${workspacePath}/05-c c lin k`,
        type: 'file',
        size: 0,
        modifiedAt: 2,
      },
    ])

    await useFsStore.getState().setWorkspace(workspacePath)
    await useFsStore.getState().confirmRename(`${workspacePath}/a`, '05-c c lin k')

    expect(window.cclinkStudio.fs.rename).toHaveBeenCalledWith(
      `${workspacePath}/a`,
      `${workspacePath}/05-c c lin k`,
    )
    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({
        name: '05-c c lin k',
        path: `${workspacePath}/05-c c lin k`,
      }),
    ])
    expect(useFsStore.getState().error).toBeNull()
    expect(useFsStore.getState().operationError).toBeNull()
  })

  it('refreshes workspace and reloads expanded directories', async () => {
    const workspacePath = '/Users/apple/project'
    const childDir = `${workspacePath}/docs`
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockImplementation((path: string) => {
      if (path === workspacePath) {
        return Promise.resolve([
          {
            name: 'docs',
            path: childDir,
            type: 'directory',
            size: 0,
            modifiedAt: 1,
          },
        ])
      }
      if (path === childDir) {
        return Promise.resolve([
          {
            name: 'new.md',
            path: `${childDir}/new.md`,
            type: 'file',
            extension: '.md',
            size: 0,
            modifiedAt: 2,
          },
        ])
      }
      return Promise.resolve([])
    })

    await useFsStore.getState().setWorkspace(workspacePath)
    await useFsStore.getState().toggleDir(childDir)
    await useFsStore.getState().refreshWorkspace()

    expect(readDir).toHaveBeenCalledWith(workspacePath)
    expect(readDir).toHaveBeenCalledWith(childDir)
    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({
        path: childDir,
        expanded: true,
        children: [
          expect.objectContaining({
            name: 'new.md',
            path: `${childDir}/new.md`,
          }),
        ],
      }),
    ])
  })

  it('keeps workspace visible when rename fails', async () => {
    const workspacePath = '/Users/apple/project'
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockResolvedValue([
      {
        name: 'a',
        path: `${workspacePath}/a`,
        type: 'file',
        size: 0,
        modifiedAt: 1,
      },
    ])
    const rename = window.cclinkStudio.fs.rename as ReturnType<typeof vi.fn>
    rename.mockRejectedValue(new Error('ENOENT'))

    await useFsStore.getState().setWorkspace(workspacePath)
    await useFsStore.getState().confirmRename(`${workspacePath}/a`, '05-c c lin k')

    expect(useFsStore.getState().workspacePath).toBe(workspacePath)
    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({
        name: 'a',
        path: `${workspacePath}/a`,
      }),
    ])
    expect(useFsStore.getState().error).toBeNull()
    expect(useFsStore.getState().operationError).toContain('重命名失败')
  })
})
