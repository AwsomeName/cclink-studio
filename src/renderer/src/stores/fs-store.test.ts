import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { useAgentStore } from './agent-store'
import { useBrowserStore } from './browser-store'
import { useEditorStore } from './editor-store'
import { useFsStore } from './fs-store'
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
      deepink: {
        fs: {
          readDir: vi.fn().mockResolvedValue([]),
        },
        workspaceState: {
          get: vi.fn(),
          setSection: vi.fn().mockResolvedValue({ success: true }),
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
              backend: 'deepink-agent',
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

    const getWorkspaceState = window.deepink.workspaceState.get as ReturnType<typeof vi.fn>
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
    expect(useAgentStore.getState().activeConversationId).toBe(conversationId)
    expect(useAgentStore.getState().messages.at(-1)?.rawText).toBe('恢复项目里的这条消息')
  })

  it('restores recent projects from last workspace and local fallback after restart', async () => {
    const lastWorkspacePath = '/Users/apple/current-project'
    const oldWorkspacePath = '/Users/apple/old-project'
    localStorageData.set('deepink-recent-workspaces', JSON.stringify([oldWorkspacePath]))

    const getAll = window.deepink.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath,
      recentWorkspacePaths: [],
    })
    const getWorkspaceState = window.deepink.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockResolvedValue(snapshot(lastWorkspacePath, {}))

    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([
      lastWorkspacePath,
      oldWorkspacePath,
    ])
    expect(window.deepink.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [lastWorkspacePath, oldWorkspacePath],
    })
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'deepink-recent-workspaces',
      JSON.stringify([lastWorkspacePath, oldWorkspacePath]),
    )
  })

  it('keeps recent projects from local fallback when settings are empty', async () => {
    const oldWorkspacePath = '/Users/apple/old-project'
    localStorageData.set('deepink-recent-workspaces', JSON.stringify([oldWorkspacePath]))

    await useFsStore.getState().initWorkspace()

    expect(useFsStore.getState().recentWorkspacePaths).toEqual([oldWorkspacePath])
    expect(window.deepink.settings.set).toHaveBeenCalledWith({
      recentWorkspacePaths: [oldWorkspacePath],
    })
  })

  it('clears stale project runtime when the last workspace path no longer opens', async () => {
    const missingWorkspacePath = '/Users/apple/missing-project'
    const staleConversationId = useAgentStore.getState().createConversation({ activate: true })
    useBrowserStore.getState().ensureTab('stale-browser', 'https://stale.example')
    useTabStore.getState().openTab({ type: 'browser', title: 'Stale', icon: '🌐' })
    useEditorStore.getState().initVirtualFile('virtual:stale', 'stale draft')
    setWorkspaceStatePath(missingWorkspacePath)

    const getAll = window.deepink.settings.getAll as ReturnType<typeof vi.fn>
    getAll.mockResolvedValue({
      lastWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [missingWorkspacePath],
    })
    const readDir = window.deepink.fs.readDir as ReturnType<typeof vi.fn>
    readDir.mockRejectedValue(new Error('ENOENT'))
    const getWorkspaceState = window.deepink.workspaceState.get as ReturnType<typeof vi.fn>
    getWorkspaceState.mockImplementation((key: string | null) => {
      if (key === null) {
        return Promise.resolve(snapshot(null, {
          tabs: { tabs: [], activeTabId: null },
          browserTabs: { tabs: {} },
          editorDrafts: { files: {} },
          agentConversations: {
            conversations: {},
            conversationOrder: [],
            activeConversationId: null,
          },
          fileTree: { expandedPaths: [], selectedPath: null },
        }))
      }
      return Promise.resolve(snapshot(key, {
        fileTree: { expandedPaths: [missingWorkspacePath], selectedPath: missingWorkspacePath },
      }))
    })

    await useFsStore.getState().initWorkspace()

    expect(useWorkspaceStore.getState().activeWorkspaceRef).toEqual({ kind: 'global' })
    expect(useFsStore.getState().workspacePath).toBeNull()
    expect(useTabStore.getState().tabs).toEqual([])
    expect(useBrowserStore.getState().tabs).toEqual({})
    expect(useEditorStore.getState().files).toEqual({})
    expect(useAgentStore.getState().activeConversationId).not.toBe(staleConversationId)
    expect(window.deepink.settings.set).toHaveBeenCalledWith({ lastWorkspacePath: '' })
  })
})
