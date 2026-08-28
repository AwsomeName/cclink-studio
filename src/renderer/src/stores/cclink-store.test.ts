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

  it('keeps remote Agent drafts scoped by workspace and only clears the submitted version', () => {
    const store = useCclinkStore.getState()
    store.setRemoteAgentDraft('workspace-a', 'first draft')
    store.setRemoteAgentDraft('workspace-b', 'other project')
    store.setRemoteAgentDraft('workspace-a', 'edited while sending')

    store.clearRemoteAgentDraft('workspace-a', 'first draft')
    expect(useCclinkStore.getState().remoteAgentDrafts).toEqual({
      'workspace-a': 'edited while sending',
      'workspace-b': 'other project',
    })

    store.clearRemoteAgentDraft('workspace-a', 'edited while sending')
    expect(useCclinkStore.getState().remoteAgentDrafts).toEqual({
      'workspace-b': 'other project',
    })
  })

  it('keeps transient remote images scoped by workspace and clears only submitted attachments', () => {
    const first = {
      id: 'image-1',
      name: 'first.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    const second = { ...first, id: 'image-2', name: 'second.png' }
    const later = { ...first, id: 'image-3', name: 'later.png' }
    const store = useCclinkStore.getState()

    store.addRemoteAgentImages('workspace-a', [first, second])
    store.addRemoteAgentImages('workspace-b', [later])
    store.clearRemoteAgentImages('workspace-a', [first.id])

    expect(useCclinkStore.getState().remoteAgentImages).toEqual({
      'workspace-a': [second],
      'workspace-b': [later],
    })
    store.removeRemoteAgentImage('workspace-a', second.id)
    expect(useCclinkStore.getState().remoteAgentImages).toEqual({
      'workspace-b': [later],
    })
  })

  it('sends remote image bytes only through the bounded CCLink message IPC', async () => {
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    const sendAgentMessage = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { cclink: { sendAgentMessage } } })

    await expect(
      useCclinkStore
        .getState()
        .sendAgentMessage(
          workspaceRef,
          'session-1',
          '',
          [image],
          '6e168c6e-82d8-4c8c-8092-1a3666704368',
        ),
    ).resolves.toBe(true)

    expect(sendAgentMessage).toHaveBeenCalledWith({
      ref: workspaceRef,
      sessionId: 'session-1',
      content: '',
      images: [image],
      imageUploadId: '6e168c6e-82d8-4c8c-8092-1a3666704368',
    })
  })

  it('releases the local active projection after the user stops remote tracking', async () => {
    const stopTrackingAgentRun = vi.fn().mockResolvedValue({ success: true })
    const listMessages = vi.fn().mockResolvedValue([
      {
        type: 'system',
        id: 'tracking-stopped',
        content: '已停止在 Studio 中跟踪这条远程任务；这不代表远端已取消。',
        timestamp: 2,
      },
    ])
    vi.stubGlobal('window', {
      cclinkStudio: { cclink: { stopTrackingAgentRun, listMessages } },
    })
    useCclinkStore.setState({ sessions: [{ ...session('session-1'), status: 'active' }] })

    await expect(
      useCclinkStore.getState().stopTrackingAgentRun(workspaceRef, 'session-1'),
    ).resolves.toBe(true)

    expect(stopTrackingAgentRun).toHaveBeenCalledWith({ ref: workspaceRef, sessionId: 'session-1' })
    expect(useCclinkStore.getState().sessions[0]?.status).toBe('idle')
    expect(useCclinkStore.getState().messages['session-1']?.[0]).toMatchObject({
      type: 'system',
      id: 'tracking-stopped',
    })
  })
})
