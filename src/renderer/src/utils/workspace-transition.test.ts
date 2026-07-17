import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { localWorkspaceRef } from '../../../shared/workspace-ref'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
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
    applyWorkspaceRuntimeTransition(transition)

    expect(getWorkspaceStateKey()).toBe('/workspace/b')
    expect(useTabStore.getState().activeTabId).toBe('browser-b')
    expect(setSection.mock.calls.every((call) => call[0] === '/workspace/b')).toBe(true)
  })

  it('drops a completed transition when a newer project switch has already started', () => {
    const staleGeneration = beginWorkspaceRuntimeTransition()
    const currentGeneration = beginWorkspaceRuntimeTransition()

    const staleApplied = applyWorkspaceRuntimeTransition({
      ref: localWorkspaceRef('/workspace/b'),
      key: '/workspace/b',
      snapshot: snapshot('/workspace/b', {}),
      generation: staleGeneration,
    })
    const currentApplied = applyWorkspaceRuntimeTransition({
      ref: localWorkspaceRef('/workspace/c'),
      key: '/workspace/c',
      snapshot: snapshot('/workspace/c', {}),
      generation: currentGeneration,
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
})
