import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { localWorkspaceRef } from '../../../shared/workspace-ref'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useBrowserTaskStore } from '../stores/browser-task-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import {
  getWorkspaceStateKey,
  setWorkspaceStateOwnerKey,
  setWorkspaceStatePath,
} from './workspace-state'
import {
  applyWorkspaceRuntimeTransition,
  beginWorkspaceRuntimeTransition,
  collectWorkspaceRuntimeResourceOwnership,
  prepareWorkspaceRuntimeTransition,
} from './workspace-transition'

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

beforeEach(() => {
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: {
        get: vi.fn().mockResolvedValue(
          snapshot('/workspace/b', {
            tabs: {
              tabs: [
                {
                  id: 'browser-b',
                  type: 'browser',
                  title: 'B',
                  icon: '🌐',
                  workspaceRef: localWorkspaceRef('/workspace/b'),
                },
              ],
              activeTabId: 'browser-b',
            },
            browserTabs: { tabs: {} },
            editorDrafts: { files: {} },
            agentConversations: {
              conversations: {},
              conversationOrder: [],
              activeConversationId: null,
            },
          }),
        ),
        setSection: vi.fn().mockResolvedValue({ success: true }),
      },
      browser: {
        reconcileViews: vi.fn().mockResolvedValue(undefined),
      },
      terminal: {
        listSessions: vi.fn().mockResolvedValue([]),
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
  useEditorStore.setState(useEditorStore.getInitialState(), true)
  useTabStore.setState(
    {
      ...useTabStore.getInitialState(),
      tabs: [{ id: 'browser-a', type: 'browser', title: 'A', icon: '🌐' }],
      activeTabId: 'browser-a',
    },
    true,
  )
  setWorkspaceStatePath('/workspace/a')
  setWorkspaceStateOwnerKey('local:owner-1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setWorkspaceStatePath(null)
  setWorkspaceStateOwnerKey(null)
})

describe('workspace-transition', () => {
  it('persists the current workspace before loading and applying the next runtime snapshot', async () => {
    const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b'))
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    const setSection = window.cclinkStudio.workspaceState.setSection as ReturnType<typeof vi.fn>

    expect(getSnapshot).toHaveBeenCalledWith('/workspace/b', 'local:owner-1')
    expect(setSection.mock.calls.some((call) => call[0] === '/workspace/a')).toBe(true)

    setSection.mockClear()
    await applyWorkspaceRuntimeTransition(transition)

    expect(getWorkspaceStateKey()).toBe('/workspace/b')
    expect(useTabStore.getState().activeTabId).toBe('browser-b')
    expect(window.cclinkStudio.browser.reconcileViews).toHaveBeenCalledWith({
      workspaceKey: '/workspace/b',
      validTabIds: ['browser-b'],
      activeTabId: null,
    })
    expect(setSection.mock.calls.every((call) => call[0] === '/workspace/b')).toBe(true)
  })

  it('drops a completed transition when a newer project switch has already started', async () => {
    const staleGeneration = beginWorkspaceRuntimeTransition()
    const currentGeneration = beginWorkspaceRuntimeTransition()

    const staleApplied = await applyWorkspaceRuntimeTransition({
      ref: localWorkspaceRef('/workspace/b'),
      key: '/workspace/b',
      snapshot: snapshot('/workspace/b', {}),
      generation: staleGeneration,
      outgoingOwnership: collectWorkspaceRuntimeResourceOwnership('/workspace/a'),
    })
    const currentApplied = await applyWorkspaceRuntimeTransition({
      ref: localWorkspaceRef('/workspace/c'),
      key: '/workspace/c',
      snapshot: snapshot('/workspace/c', {}),
      generation: currentGeneration,
      outgoingOwnership: collectWorkspaceRuntimeResourceOwnership('/workspace/a'),
    })

    expect(staleApplied).toBe(false)
    expect(currentApplied).toBe(true)
    expect(getWorkspaceStateKey()).toBe('/workspace/c')
  })

  it('aborts a project switch when the target snapshot cannot be read', async () => {
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getSnapshot.mockRejectedValueOnce(new Error('state unavailable'))

    await expect(
      prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b')),
    ).rejects.toThrow('state unavailable')
    expect(getWorkspaceStateKey()).toBe('/workspace/a')
  })

  it('unbinds visible resources without terminating background agent or terminal runtimes', async () => {
    const workspaceA = localWorkspaceRef('/workspace/a')
    const workspaceB = localWorkspaceRef('/workspace/b')
    const agentA = useAgentStore.getState().createConversation({
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: workspaceA,
      },
    })
    const runA = useAgentStore.getState().beginRun(agentA)
    useBrowserTaskStore.getState().upsertTask({
      id: 'browser-task-a',
      tabId: 'browser-a',
      goal: 'continue in workspace A',
      status: 'running',
      startedAt: 1,
      downloadIds: [],
    })
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-a',
          type: 'browser',
          title: 'Browser A',
          icon: 'browser',
          workspaceRef: workspaceA,
        },
        {
          id: 'terminal-a',
          type: 'terminal',
          title: 'Terminal A',
          icon: 'terminal',
          workspaceRef: workspaceA,
          terminal: {
            runtime: {
              location: 'local',
              transport: 'local',
              backend: 'local-shell',
              workspaceRef: workspaceA,
            },
            permissionPolicy: { mode: 'ask-risky-command', requireConfirmationFor: [] },
            status: 'running',
            closePolicy: 'keep-running',
            sessionId: 'terminal-session-a',
          },
        },
      ],
      activeTabId: 'browser-a',
    })

    const conversationA = useAgentStore.getState().conversations[agentA]!
    const conversationB = {
      ...conversationA,
      id: 'agent-b',
      title: 'Agent B',
      runtime: { ...conversationA.runtime, workspaceRef: workspaceB },
      loading: false,
      runStatus: 'idle' as const,
      activeRunId: null,
      lastRunEventAt: null,
    }
    const targetSnapshot = snapshot('/workspace/b', {
      tabs: {
        tabs: [
          {
            id: 'browser-b',
            type: 'browser',
            title: 'Browser B',
            icon: 'browser',
            workspaceRef: workspaceB,
          },
          {
            id: 'terminal-b',
            type: 'terminal',
            title: 'Terminal B',
            icon: 'terminal',
            workspaceRef: workspaceB,
            terminal: {
              runtime: {
                location: 'local',
                transport: 'local',
                backend: 'local-shell',
                workspaceRef: workspaceB,
              },
              permissionPolicy: { mode: 'ask-risky-command', requireConfirmationFor: [] },
              status: 'running',
              closePolicy: 'keep-running',
              sessionId: 'terminal-session-b',
            },
          },
        ],
        activeTabId: 'terminal-b',
      },
      browserTabs: { tabs: {} },
      editorDrafts: { files: {} },
      agentConversations: {
        conversations: { 'agent-b': conversationB },
        conversationOrder: ['agent-b'],
        activeConversationId: 'agent-b',
      },
    })
    const getSnapshot = window.cclinkStudio.workspaceState.get as ReturnType<typeof vi.fn>
    getSnapshot.mockResolvedValueOnce(targetSnapshot)
    const listSessions = window.cclinkStudio.terminal.listSessions as ReturnType<typeof vi.fn>
    listSessions.mockResolvedValueOnce([
      {
        sessionId: 'terminal-session-b',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: workspaceB,
        },
        status: 'exited',
        createdAt: 1,
        updatedAt: 2,
        exitCode: 0,
        exitedAt: 2,
        attachable: false,
      },
    ])

    const transition = await prepareWorkspaceRuntimeTransition(workspaceB)
    expect(transition.outgoingOwnership).toMatchObject({
      workspaceKey: '/workspace/a',
      browserTabIds: ['browser-a'],
      browserTaskIds: ['browser-task-a'],
      activeBrowserTabId: 'browser-a',
      agentConversationIds: [agentA],
      activeAgentConversationId: agentA,
      terminalSessionIds: ['terminal-session-a'],
    })

    await expect(applyWorkspaceRuntimeTransition(transition)).resolves.toBe(true)

    expect(window.cclinkStudio.browser.reconcileViews).toHaveBeenLastCalledWith({
      workspaceKey: '/workspace/b',
      validTabIds: ['browser-b'],
      activeTabId: null,
    })
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual(['browser-b', 'terminal-b'])
    expect(useTabStore.getState().tabs.find((tab) => tab.id === 'terminal-b')).toMatchObject({
      terminal: { status: 'exited', processId: undefined },
      terminalRecord: { status: 'exited', exitCode: 0, attachable: false },
    })
    expect(useAgentStore.getState().activeConversationId).toBe('agent-b')
    expect(useAgentStore.getState().conversations[agentA]).toMatchObject({
      activeRunId: runA,
      loading: true,
      runStatus: 'starting',
    })
    expect(useBrowserTaskStore.getState().tasks['browser-task-a']).toMatchObject({
      tabId: 'browser-a',
      status: 'running',
    })
    expect(collectWorkspaceRuntimeResourceOwnership('/workspace/b')).toMatchObject({
      browserTabIds: ['browser-b'],
      browserTaskIds: [],
      agentConversationIds: ['agent-b'],
      activeAgentConversationId: 'agent-b',
      terminalSessionIds: ['terminal-session-b'],
    })
  })

  it('continues switching when the optional browser runtime cannot reconcile ownership', async () => {
    const reconcileViews = window.cclinkStudio.browser.reconcileViews as ReturnType<typeof vi.fn>
    reconcileViews.mockRejectedValueOnce(new Error('browser unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b'))

    await expect(applyWorkspaceRuntimeTransition(transition)).resolves.toBe(true)

    expect(getWorkspaceStateKey()).toBe('/workspace/b')
    expect(warn).toHaveBeenCalledWith(
      '[WorkspaceTransition] Browser runtime ownership update failed:',
      expect.any(Error),
    )
  })

  it('continues switching when terminal status reconciliation is unavailable', async () => {
    const listSessions = window.cclinkStudio.terminal.listSessions as ReturnType<typeof vi.fn>
    listSessions.mockRejectedValueOnce(new Error('terminal unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef('/workspace/b'))

    await expect(applyWorkspaceRuntimeTransition(transition)).resolves.toBe(true)

    expect(getWorkspaceStateKey()).toBe('/workspace/b')
    expect(warn).toHaveBeenCalledWith(
      '[WorkspaceRuntime] Terminal session reconciliation failed:',
      expect.any(Error),
    )
  })
})
