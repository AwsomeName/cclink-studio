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
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
})

describe('cclink session selection ownership', () => {
  it('restores a signed-in session without starting the realtime connection', async () => {
    const connectRealtime = vi.fn()
    vi.stubGlobal('window', {
      cclinkStudio: {
        auth: {
          getServiceStatus: vi.fn().mockResolvedValue({ configured: true }),
          checkSession: vi.fn().mockResolvedValue({
            loggedIn: true,
            user: { id: 'user-1', phone: '13800000000' },
          }),
          onSessionChanged: vi.fn(() => () => undefined),
        },
        cclink: {
          connectRealtime,
          onRealtimeStatus: vi.fn(() => () => undefined),
          onRealtimeEvent: vi.fn(() => () => undefined),
        },
      },
    })
    useCclinkStore.setState(useCclinkStore.getInitialState(), true)

    await useCclinkStore.getState().initialize()

    expect(useCclinkStore.getState().session.loggedIn).toBe(true)
    expect(useCclinkStore.getState().realtime.state).toBe('idle')
    expect(connectRealtime).not.toHaveBeenCalled()
  })

  it('starts the realtime connection only after an explicit request', async () => {
    const connectRealtime = vi.fn().mockResolvedValue({ state: 'online' })
    const listServers = vi.fn().mockResolvedValue([])
    vi.stubGlobal('window', {
      cclinkStudio: {
        cclink: { connectRealtime, listServers },
      },
    })
    useCclinkStore.setState({
      initialized: true,
      service: { configured: true },
      session: {
        loggedIn: true,
        user: {
          id: 'user-1',
          nickname: '测试用户',
          avatarUrl: '',
          phone: '13800000000',
          loginMethod: 'phone',
          lastLoginAt: 1,
        },
      },
      realtime: { state: 'idle' },
    })

    await expect(useCclinkStore.getState().connectRealtime()).resolves.toBe(true)

    expect(connectRealtime).toHaveBeenCalledOnce()
    expect(listServers).toHaveBeenCalledOnce()
    expect(useCclinkStore.getState().realtime.state).toBe('online')
  })

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
