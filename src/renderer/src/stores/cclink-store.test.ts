import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CclinkRemoteSession } from '@shared/cclink'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from './cclink-store'

const workspaceRef = remoteWorkspaceRef({
  endpointId: 'endpoint-1',
  workspaceId: 'workspace-1',
  path: '/workspace',
})

function session(id: string): CclinkRemoteSession {
  return {
    id,
    name: '远程会话',
    workspaceId: workspaceRef.workspaceId,
    workspacePath: workspaceRef.path,
    serverId: workspaceRef.endpointId,
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    contextUsage: 0,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useCclinkStore.setState({ sessions: [], selectedSessionId: null, loading: false, error: null })
})

describe('cclink session selection ownership', () => {
  it('can create an idle session without changing the visible selection', async () => {
    const created = session('created')
    vi.stubGlobal('window', {
      cclinkStudio: { cclink: { createSession: vi.fn().mockResolvedValue(created) } },
    })
    useCclinkStore.setState({ selectedSessionId: 'visible-session' })

    await useCclinkStore.getState().createSession(workspaceRef, '新远程会话', { select: false })

    expect(useCclinkStore.getState().sessions).toContainEqual(created)
    expect(useCclinkStore.getState().selectedSessionId).toBe('visible-session')
  })

  it('preserves the existing create-and-select behavior for other callers', async () => {
    const created = session('created-and-selected')
    vi.stubGlobal('window', {
      cclinkStudio: { cclink: { createSession: vi.fn().mockResolvedValue(created) } },
    })

    await useCclinkStore.getState().createSession(workspaceRef, '新远程会话')

    expect(useCclinkStore.getState().selectedSessionId).toBe(created.id)
  })
})
