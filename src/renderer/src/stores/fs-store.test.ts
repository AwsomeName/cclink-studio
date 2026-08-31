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
import { toLocalFileUrl } from '../utils/html-files'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
          beginFileRelocation: vi.fn().mockResolvedValue(undefined),
          markFileRelocationCommitted: vi.fn().mockResolvedValue(undefined),
          completeFileRelocation: vi.fn().mockResolvedValue(undefined),
          listPendingFileRelocations: vi.fn().mockResolvedValue([]),
          isDirectory: vi.fn().mockResolvedValue(true),
          rename: vi.fn().mockResolvedValue(undefined),
          move: vi.fn().mockResolvedValue(undefined),
          copyEntry: vi.fn().mockResolvedValue({
            sourcePath: '/Users/apple/project/source',
            destinationPath: '/Users/apple/project/source 副本',
          }),
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockResolvedValue(undefined),
          createFile: vi.fn().mockResolvedValue(undefined),
          watchDir: vi.fn().mockResolvedValue(vi.fn()),
        },
        workspaceState: {
          setActiveLocalWorkspace: vi.fn(async (workspacePath: string | null) => ({
            success: true,
            activeWorkspace: { workspacePath, generation: 1 },
          })),
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
        dialog: {
          showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
        },
        browser: {
          navigate: vi.fn().mockResolvedValue(undefined),
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setWorkspaceStatePath(null)
    setWorkspaceStateOwnerKey(null)
  })

  it('creates a new file through the exclusive create API', async () => {
    useFsStore.setState({
      workspacePath: '/Users/apple/project',
      newFolderParent: '/Users/apple/project',
      editingPath: '__new_file__',
    })

    await useFsStore.getState().confirmNewFile('notes.md')

    expect(window.cclinkStudio.fs.createFile).toHaveBeenCalledWith('/Users/apple/project/notes.md')
    expect(window.cclinkStudio.fs.writeFile).not.toHaveBeenCalled()
    expect(useFsStore.getState().selectedPath).toBe('/Users/apple/project/notes.md')
    expect(useFsStore.getState().operationError).toBeNull()
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

    const switched = await useFsStore.getState().openRecentWorkspace(workspacePath)

    expect(switched).toBe(true)
    expect(getWorkspaceState).toHaveBeenCalledWith(workspacePath, 'local:owner-1')
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: workspacePath,
    })
    expect(useOpenProjectsStore.getState().openProjectPaths).toEqual([workspacePath])
    expect(useAgentStore.getState().activeConversationId).toBe(conversationId)
    expect(useAgentStore.getState().messages.at(-1)?.rawText).toBe('恢复项目里的这条消息')
  })

  it('switches projects with a dirty draft without using a native confirmation dialog', async () => {
    const currentPath = '/Users/apple/current-project'
    const nextPath = '/Users/apple/next-project'
    const confirm = vi.fn(() => false)
    Object.assign(window, { confirm })
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: currentPath })
    useFsStore.setState({ workspacePath: currentPath })
    useEditorStore.getState().initVirtualFile('virtual:draft', '未保存草稿')

    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(nextPath, {}))

    const switched = await useFsStore.getState().openRecentWorkspace(nextPath)

    expect(switched).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(useFsStore.getState().switchingPath).toBeNull()
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: nextPath,
    })
    expect(window.cclinkStudio.workspaceState.setSection).toHaveBeenCalledWith(
      currentPath,
      'editorDrafts',
      expect.anything(),
      'local:owner-1',
    )
  })

  it('reports project switch failures and clears the switching state', async () => {
    const nextPath = '/Users/apple/missing-project'
    const resolveLocalWorkspace = window.cclinkStudio.workspaceState
      .resolveLocalWorkspace as ReturnType<typeof vi.fn>
    resolveLocalWorkspace.mockResolvedValue({ valid: false, workspacePath: null })

    const switched = await useFsStore.getState().openRecentWorkspace(nextPath)

    expect(switched).toBe(false)
    expect(useFsStore.getState().switchingPath).toBeNull()
    expect(useFsStore.getState().error).toBe('该工作空间已不存在或不可访问')
  })

  it('exposes the target project while an asynchronous switch is in progress', async () => {
    const nextPath = '/Users/apple/slow-project'
    let finishResolve: ((value: { valid: true; workspacePath: string }) => void) | undefined
    const resolveLocalWorkspace = window.cclinkStudio.workspaceState
      .resolveLocalWorkspace as ReturnType<typeof vi.fn>
    resolveLocalWorkspace.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishResolve = resolve
        }),
    )
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(nextPath, {}))

    const switching = useFsStore.getState().openRecentWorkspace(nextPath)

    expect(useFsStore.getState().switchingPath).toBe(nextPath)
    finishResolve?.({ valid: true, workspacePath: nextPath })
    await expect(switching).resolves.toBe(true)
    expect(useFsStore.getState().switchingPath).toBeNull()
  })

  it('keeps the current workspace projection until asynchronous runtime preparation finishes', async () => {
    const currentPath = '/Users/apple/current-project'
    const nextPath = '/Users/apple/next-project'
    let resolveSessions!: (sessions: []) => void
    const listSessions = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveSessions = resolve
        }),
    )
    Object.assign(window.cclinkStudio, {
      browser: { reconcileViews: vi.fn().mockResolvedValue(undefined) },
      terminal: { listSessions },
    })
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: currentPath })
    useFsStore.setState({
      workspacePath: currentPath,
      selectedPath: `${currentPath}/selected.md`,
      expandedPaths: [`${currentPath}/docs`],
    })
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: 'A',
          icon: 'browser',
          browserProfile: 'account-a-profile',
          webResourceRef: { accountId: 'account-a' },
          workspaceRef: { kind: 'local', path: currentPath },
        },
      ],
      activeTabId: 'browser-a',
    })
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(
      snapshot(nextPath, {
        tabs: {
          tabs: [
            {
              id: 'browser-b',
              type: 'browser',
              title: 'B',
              icon: 'browser',
              browserProfile: 'account-b-profile',
              webResourceRef: { accountId: 'account-b' },
              workspaceRef: { kind: 'local', path: nextPath },
            },
          ],
          activeTabId: 'browser-b',
        },
      }),
    )

    const switching = useFsStore.getState().openRecentWorkspace(nextPath)
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledOnce())

    expect(useFsStore.getState().workspacePath).toBe(currentPath)
    expect(useFsStore.getState().selectedPath).toBe(`${currentPath}/selected.md`)
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: currentPath,
    })
    expect(useTabStore.getState().activeTabId).toBe('browser-a')

    resolveSessions([])
    await expect(switching).resolves.toBe(true)
    expect(useFsStore.getState().workspacePath).toBe(nextPath)
    expect(useFsStore.getState().selectedPath).toBeNull()
    expect(useFsStore.getState().expandedPaths).toEqual([])
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: nextPath,
    })
    expect(useTabStore.getState().activeTabId).toBe('browser-b')
  })

  it('commits the global workspace only after runtime preparation finishes', async () => {
    const currentPath = '/Users/apple/current-project'
    let resolveSessions!: (sessions: []) => void
    const listSessions = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveSessions = resolve
        }),
    )
    Object.assign(window.cclinkStudio, {
      browser: { reconcileViews: vi.fn().mockResolvedValue(undefined) },
      terminal: { listSessions },
    })
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: currentPath })
    useFsStore.setState({ workspacePath: currentPath })
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(
      snapshot(null, {
        tabs: { tabs: [], activeTabId: null },
        fileTree: { expandedPaths: [], selectedPath: null },
      }),
    )

    const closing = useFsStore.getState().closeWorkspace()
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledOnce())

    expect(useFsStore.getState().workspacePath).toBe(currentPath)
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({
      kind: 'local',
      path: currentPath,
    })

    resolveSessions([])
    await closing
    expect(useFsStore.getState().workspacePath).toBeNull()
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({ kind: 'global' })
    expect(useFsStore.getState().loading).toBe(false)
    expect(useFsStore.getState().switchingPath).toBeNull()
  })

  it('returns to the global workspace when the last active remote project is closed', async () => {
    const remoteRef = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    }
    Object.assign(window.cclinkStudio, {
      browser: { reconcileViews: vi.fn().mockResolvedValue(undefined) },
      terminal: { listSessions: vi.fn().mockResolvedValue([]) },
    })
    useWorkspaceStore.getState().commitActiveWorkspace(remoteRef)
    const getWorkspaceState = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(
      snapshot(null, {
        tabs: { tabs: [], activeTabId: null },
        fileTree: { expandedPaths: [], selectedPath: null },
      }),
    )

    await useFsStore.getState().closeWorkspace()

    expect(useFsStore.getState().workspacePath).toBeNull()
    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({ kind: 'global' })
    expect(useFsStore.getState().loading).toBe(false)
    expect(useFsStore.getState().switchingPath).toBeNull()
  })

  it('rejects a second workspace transition while the project picker is open', async () => {
    let resolveDialog!: (value: { canceled: boolean; filePaths: string[] }) => void
    const showOpenDialog = window.cclinkStudio.dialog.showOpenDialog as ReturnType<typeof vi.fn>
    showOpenDialog.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDialog = resolve
      }),
    )

    const picking = useFsStore.getState().openWorkspacePicker()
    expect(useFsStore.getState().picking).toBe(true)

    await expect(
      useFsStore.getState().openRecentWorkspace('/Users/apple/other-project'),
    ).resolves.toBe(false)
    expect(useFsStore.getState().error).toBe('另一个项目正在切换，请稍候')
    expect(window.cclinkStudio.workspaceState.resolveLocalWorkspace).not.toHaveBeenCalled()

    resolveDialog({ canceled: true, filePaths: [] })
    await picking
    expect(useFsStore.getState().picking).toBe(false)
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
    useWorkspaceStore
      .getState()
      .commitActiveWorkspace({ kind: 'local', path: missingWorkspacePath })
    const staleConversationId = useAgentStore.getState().createConversation({ activate: true })
    useBrowserStore.getState().ensureTab('stale-browser', 'https://stale.example')
    useTabStore.getState().openTab({
      type: 'browser',
      title: 'Stale',
      icon: '🌐',
      browserProfile: 'stale-profile',
      webResourceRef: { accountId: 'stale-account' },
      workspaceRef: { kind: 'local', path: missingWorkspacePath },
    })
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
    expect(window.cclinkStudio.workspaceState.setActiveLocalWorkspace).toHaveBeenCalledWith(null)
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
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'a',
      icon: '📄',
      filePath: `${workspacePath}/a`,
    })
    useTabStore.getState().openTab({
      type: 'browser',
      title: 'a',
      icon: '🌐',
      filePath: `${workspacePath}/a`,
      forceNew: true,
    })
    const browserTab = useTabStore.getState().tabs.find((tab) => tab.type === 'browser')!
    useBrowserStore.getState().ensureTab(browserTab.id, toLocalFileUrl(`${workspacePath}/a`))
    await expect(
      useFsStore.getState().confirmRename(`${workspacePath}/a`, '05-c c lin k'),
    ).resolves.toBe(true)

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
    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        title: '05-c c lin k',
        filePath: `${workspacePath}/05-c c lin k`,
      }),
      expect.objectContaining({
        title: '05-c c lin k',
        filePath: `${workspacePath}/05-c c lin k`,
      }),
    ])
    expect(useBrowserStore.getState().tabs[browserTab.id].url).toBe(
      toLocalFileUrl(`${workspacePath}/05-c c lin k`),
    )
    expect(window.cclinkStudio.browser.navigate).toHaveBeenCalledWith(
      browserTab.id,
      toLocalFileUrl(`${workspacePath}/05-c c lin k`),
    )
  })

  it('keeps a disk rename successful when Browser navigation cannot reload the local file', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/index.html`
    const targetPath = `${workspacePath}/renamed.html`
    const navigate = window.cclinkStudio.browser.navigate as ReturnType<typeof vi.fn>
    navigate.mockRejectedValue(new Error('browser view unavailable'))
    useFsStore.setState({ workspacePath, tree: [] })
    useTabStore.getState().openTab({
      type: 'browser',
      title: 'index.html',
      icon: '🌐',
      filePath: sourcePath,
      forceNew: true,
    })
    const browserTab = useTabStore.getState().tabs.find((tab) => tab.type === 'browser')!
    useBrowserStore.getState().ensureTab(browserTab.id, toLocalFileUrl(sourcePath))

    await expect(useFsStore.getState().confirmRename(sourcePath, 'renamed.html')).resolves.toBe(
      true,
    )

    expect(useTabStore.getState().tabs.find((tab) => tab.id === browserTab.id)?.filePath).toBe(
      targetPath,
    )
    expect(useBrowserStore.getState().tabs[browserTab.id]?.url).toBe(toLocalFileUrl(targetPath))
    expect(useFsStore.getState().operationError).toContain('重命名已完成')
  })

  it('reports projection recovery instead of disk failure when WorkspaceState persistence fails', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.txt`
    const targetPath = `${workspacePath}/renamed.txt`
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>
    setSection.mockResolvedValue({ success: false, error: 'state file unavailable' })
    useFsStore.setState({ workspacePath, tree: [] })
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'note.txt',
      icon: '📄',
      filePath: sourcePath,
    })

    await expect(useFsStore.getState().confirmRename(sourcePath, 'renamed.txt')).resolves.toBe(true)

    expect(window.cclinkStudio.fs.rename).toHaveBeenCalledWith(sourcePath, targetPath)
    expect(useTabStore.getState().tabs[0]?.filePath).toBe(targetPath)
    expect(useFsStore.getState().operationError).toContain('重命名已完成')
  })

  it('keeps the committed rename projected when the follow-up directory refresh fails', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.txt`
    const targetPath = `${workspacePath}/renamed.txt`
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir
      .mockResolvedValueOnce([
        {
          name: 'note.txt',
          path: sourcePath,
          type: 'file',
          size: 1,
          modifiedAt: 1,
        },
      ])
      .mockRejectedValueOnce(new Error('temporary refresh failure'))

    await useFsStore.getState().setWorkspace(workspacePath)
    useFsStore.getState().setSelectedPath(sourcePath)

    await expect(useFsStore.getState().confirmRename(sourcePath, 'renamed.txt')).resolves.toBe(true)

    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({ name: 'renamed.txt', path: targetPath }),
    ])
    expect(useFsStore.getState().selectedPath).toBe(targetPath)
    expect(useFsStore.getState().operationError).toContain('重命名已完成')
  })

  it('retries an idempotent Store projection after the disk rename has committed', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.txt`
    const targetPath = `${workspacePath}/renamed.txt`
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockResolvedValue([])
    useFsStore.setState({ workspacePath, tree: [] })
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'note.txt',
      icon: '📄',
      filePath: sourcePath,
    })
    const tabState = useTabStore.getState()
    const originalRebase = tabState.rebaseFilePaths
    const rebase = vi
      .spyOn(tabState, 'rebaseFilePaths')
      .mockImplementationOnce(() => {
        throw new Error('injected tab projection failure')
      })
      .mockImplementation(originalRebase)

    await expect(useFsStore.getState().confirmRename(sourcePath, 'renamed.txt')).resolves.toBe(true)

    expect(rebase).toHaveBeenCalledTimes(2)
    expect(useTabStore.getState().tabs[0]?.filePath).toBe(targetPath)
    expect(useFsStore.getState().operationError).toBeNull()
  })

  it('queues a save requested during rename and writes it to the committed path', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.txt`
    const targetPath = `${workspacePath}/renamed.txt`
    const renameGate = deferred<void>()
    const rename = window.cclinkStudio.fs.rename as ReturnType<typeof vi.fn>
    rename.mockImplementation(() => renameGate.promise)
    const saveTextDocument = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        path: targetPath,
        content: 'unsaved edit',
        size: 12,
        modifiedAt: 2,
        hash: 'saved-hash',
      },
    })
    Object.assign(window.cclinkStudio.fs, { saveTextDocument })
    useFsStore.setState({ workspacePath, tree: [] })
    useEditorStore.setState({
      files: {
        [sourcePath]: {
          savedContent: 'saved',
          currentContent: 'unsaved edit',
          dirty: true,
          loading: false,
        },
      },
      pendingUpdates: [],
    })

    const renamePromise = useFsStore.getState().confirmRename(sourcePath, 'renamed.txt')
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith(sourcePath, targetPath))
    const savePromise = useEditorStore.getState().saveFile(sourcePath)
    expect(saveTextDocument).not.toHaveBeenCalled()

    renameGate.resolve()
    await expect(renamePromise).resolves.toBe(true)
    await expect(savePromise).resolves.toBe('saved')
    expect(saveTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: targetPath, content: 'unsaved edit' }),
    )
    expect(useEditorStore.getState().files[sourcePath]).toBeUndefined()
    expect(useEditorStore.getState().files[targetPath]?.dirty).toBe(false)
  })

  it('moves an open dirty markdown file and rebases its tab and editor buffer', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.md`
    const targetDir = `${workspacePath}/docs`
    const destinationPath = `${targetDir}/note.md`
    let moved = false
    const move = window.cclinkStudio.fs.move as ReturnType<typeof vi.fn>
    move.mockImplementation(async () => {
      moved = true
    })
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockImplementation((path: string) => {
      if (path === workspacePath) {
        return Promise.resolve([
          {
            name: 'docs',
            path: targetDir,
            type: 'directory',
            size: 0,
            modifiedAt: 1,
          },
          ...(moved
            ? []
            : [
                {
                  name: 'note.md',
                  path: sourcePath,
                  type: 'file',
                  extension: '.md',
                  size: 10,
                  modifiedAt: 1,
                },
              ]),
        ])
      }
      if (path === targetDir) {
        return Promise.resolve(
          moved
            ? [
                {
                  name: 'note.md',
                  path: destinationPath,
                  type: 'file',
                  extension: '.md',
                  size: 10,
                  modifiedAt: 2,
                },
              ]
            : [],
        )
      }
      return Promise.resolve([])
    })

    await useFsStore.getState().setWorkspace(workspacePath)
    useFsStore.getState().setSelectedPath(sourcePath)
    useTabStore.getState().openTab({
      type: 'editor',
      title: 'note.md',
      icon: '📝',
      filePath: sourcePath,
    })
    useEditorStore.setState({
      files: {
        [sourcePath]: {
          savedContent: 'saved',
          currentContent: 'unsaved edit',
          dirty: true,
          loading: false,
        },
      },
      pendingUpdates: [],
    })
    useAgentStore.getState().addMountedResource({
      id: `file:${sourcePath}`,
      kind: 'file',
      label: 'note.md',
      detail: sourcePath,
      ref: { type: 'file', path: sourcePath },
    })

    await expect(useFsStore.getState().moveEntry(sourcePath, targetDir)).resolves.toBe(true)

    expect(move).toHaveBeenCalledWith(sourcePath, destinationPath)
    expect(useFsStore.getState().selectedPath).toBe(destinationPath)
    expect(useFsStore.getState().expandedPaths).toContain(targetDir)
    expect(useTabStore.getState().tabs.at(-1)?.filePath).toBe(destinationPath)
    expect(useEditorStore.getState().files[sourcePath]).toBeUndefined()
    expect(useEditorStore.getState().files[destinationPath]).toMatchObject({
      currentContent: 'unsaved edit',
      dirty: true,
    })
    const activeConversationId = useAgentStore.getState().activeConversationId
    expect(
      useAgentStore.getState().conversations[activeConversationId].mountedResources[0],
    ).toMatchObject({
      id: `file:${destinationPath}`,
      detail: destinationPath,
      ref: { path: destinationPath },
    })
    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({
        path: targetDir,
        expanded: true,
        children: [expect.objectContaining({ path: destinationPath })],
      }),
    ])
  })

  it('rejects moving a directory into itself or its descendant', async () => {
    const workspacePath = '/Users/apple/project'
    const sourceDir = `${workspacePath}/docs`
    await useFsStore.getState().setWorkspace(workspacePath)

    await expect(useFsStore.getState().moveEntry(sourceDir, `${sourceDir}/archive`)).resolves.toBe(
      false,
    )

    expect(window.cclinkStudio.fs.move).not.toHaveBeenCalled()
    expect(useFsStore.getState().operationError).toContain('不能移动到自身或其子目录')
  })

  it('copies a selected file and pastes it into the selected directory', async () => {
    const workspacePath = '/Users/apple/project'
    const sourcePath = `${workspacePath}/note.txt`
    const targetDir = `${workspacePath}/archive`
    const destinationPath = `${targetDir}/note.txt`
    const copyEntry = window.cclinkStudio.fs.copyEntry as ReturnType<typeof vi.fn>
    copyEntry.mockResolvedValue({ sourcePath, destinationPath })
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockResolvedValue([
      {
        name: 'note.txt',
        path: destinationPath,
        type: 'file',
        extension: '.txt',
        size: 4,
        modifiedAt: 2,
      },
    ])
    useFsStore.setState({
      workspacePath,
      tree: [
        {
          name: 'note.txt',
          path: sourcePath,
          type: 'file',
          extension: '.txt',
        },
        {
          name: 'archive',
          path: targetDir,
          type: 'directory',
          expanded: false,
        },
      ],
      expandedPaths: [],
      selectedPath: sourcePath,
    })

    useFsStore.getState().copyEntryToClipboard({
      workspacePath,
      path: sourcePath,
      name: 'note.txt',
      fileType: 'file',
    })
    await expect(
      useFsStore.getState().pasteClipboardEntry(targetDir, 'directory'),
    ).resolves.toEqual({ sourcePath, destinationPath })

    expect(copyEntry).toHaveBeenCalledWith({
      sourceWorkspacePath: workspacePath,
      sourcePath,
      targetWorkspacePath: workspacePath,
      targetDirectory: targetDir,
    })
    expect(useFsStore.getState().expandedPaths).toContain(targetDir)
    expect(useFsStore.getState().selectedPath).toBe(destinationPath)
    expect(useFsStore.getState().tree).toEqual([
      expect.objectContaining({ path: sourcePath }),
      expect.objectContaining({
        path: targetDir,
        expanded: true,
        children: [expect.objectContaining({ path: destinationPath })],
      }),
    ])
  })

  it('rejects pasting a copied directory into itself before IPC', async () => {
    const workspacePath = '/Users/apple/project'
    const sourceDir = `${workspacePath}/docs`
    useFsStore.setState({
      workspacePath,
      clipboardEntry: {
        workspacePath,
        path: sourceDir,
        name: 'docs',
        fileType: 'directory',
      },
    })

    await expect(
      useFsStore.getState().pasteClipboardEntry(sourceDir, 'directory'),
    ).resolves.toBeNull()

    expect(window.cclinkStudio.fs.copyEntry).not.toHaveBeenCalled()
    expect(useFsStore.getState().operationError).toContain('不能复制到自身或其子目录')
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

  it('keeps unchanged expanded nodes mounted while refreshing their parent', async () => {
    const workspacePath = '/Users/apple/project'
    const childDir = `${workspacePath}/docs`
    const readDir = window.cclinkStudio.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockImplementation((path: string) => {
      if (path === workspacePath) {
        return Promise.resolve([
          { name: 'docs', path: childDir, type: 'directory', size: 0, modifiedAt: 1 },
        ])
      }
      return Promise.resolve([
        {
          name: 'keep.md',
          path: `${childDir}/keep.md`,
          type: 'file',
          extension: '.md',
          size: 0,
          modifiedAt: 1,
        },
      ])
    })

    await useFsStore.getState().setWorkspace(workspacePath)
    await useFsStore.getState().toggleDir(childDir)
    const nodeBeforeRefresh = useFsStore.getState().tree[0]
    const childrenBeforeRefresh = nodeBeforeRefresh?.children

    await useFsStore.getState().refreshDir(workspacePath)

    expect(useFsStore.getState().tree[0]).toBe(nodeBeforeRefresh)
    expect(useFsStore.getState().tree[0]?.children).toBe(childrenBeforeRefresh)
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
    await expect(
      useFsStore.getState().confirmRename(`${workspacePath}/a`, '05-c c lin k'),
    ).resolves.toBe(false)

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
