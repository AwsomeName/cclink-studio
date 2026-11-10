import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceRef, localWorkspaceRef } from '@shared/workspace-ref'
import type { CclinkRemoteSession } from '@shared/cclink'
import { useCclinkStore } from '../stores/cclink-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { installRemoteConversationRestore } from './use-remote-conversation-restore'

const remote = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/srv/project',
})
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

function installFixture() {
  const sessions: CclinkRemoteSession[] = ['idle', 'archived'].map((status) => ({
    id: `session-${status}`,
    name: `远程历史 ${status}`,
    status: status as 'idle' | 'archived',
    serverId: remote.endpointId,
    workspaceId: remote.workspaceId,
    workspacePath: remote.path,
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    contextUsage: 0,
  }))
  const messages = [{ type: 'agentText', id: 'message-1', timestamp: 2, content: '崩溃前的回复' }]
  const listSessions = vi.fn().mockResolvedValue(sessions)
  const listMessages = vi.fn().mockResolvedValue(messages)
  vi.stubGlobal('window', { cclinkStudio: { cclink: { listSessions, listMessages } } })
  useCclinkStore.setState({ initialized: true })
  useWorkspaceStore.setState({ activeWorkspaceRef: remote })
  return { sessions, messages, listSessions, listMessages }
}

describe('remote conversation restoration lifecycle', () => {
  it('loads saved and archived history with no navigation panel and no online connection', async () => {
    const { sessions, messages, listSessions } = installFixture()
    dispose = installRemoteConversationRestore()

    await vi.waitFor(() => expect(useCclinkStore.getState().sessions).toEqual(sessions))
    expect(listSessions).toHaveBeenCalledWith(remote)
    expect(useCclinkStore.getState().messages['session-idle']).toEqual(messages)
    expect(useCclinkStore.getState().activeSessionsRef).toEqual(remote)
  })

  it('refreshes on workspace changes and reconnect, not on ordinary message changes', async () => {
    const { listSessions } = installFixture()
    dispose = installRemoteConversationRestore()
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1))

    useCclinkStore.setState({ realtime: { state: 'online' } })
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2))
    useCclinkStore.setState({ messages: {} })
    await Promise.resolve()
    expect(listSessions).toHaveBeenCalledTimes(2)

    const next = { ...remote, workspaceId: 'workspace-2', path: '/srv/other' }
    useWorkspaceStore.setState({ activeWorkspaceRef: next })
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledWith(next))
    expect(listSessions).toHaveBeenCalledTimes(3)
  })

  it('does not initialize remote services for a local workspace or after disposal', async () => {
    const initialize = vi.fn().mockResolvedValue(undefined)
    const loadSessions = vi.fn().mockResolvedValue(undefined)
    useCclinkStore.setState({ initialize, loadSessions })
    useWorkspaceStore.setState({ activeWorkspaceRef: localWorkspaceRef('/local') })
    dispose = installRemoteConversationRestore()
    expect(initialize).not.toHaveBeenCalled()

    dispose()
    useWorkspaceStore.setState({ activeWorkspaceRef: remote })
    useCclinkStore.setState({ realtime: { state: 'online' } })
    await Promise.resolve()
    expect(initialize).not.toHaveBeenCalled()
    expect(loadSessions).not.toHaveBeenCalled()
  })

  it('does not load a stale workspace when initialization finishes after switching away', async () => {
    let finish!: () => void
    const initialize = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const loadSessions = vi.fn().mockResolvedValue(undefined)
    useCclinkStore.setState({ initialize, loadSessions })
    useWorkspaceStore.setState({ activeWorkspaceRef: remote })
    dispose = installRemoteConversationRestore()
    useWorkspaceStore.setState({ activeWorkspaceRef: localWorkspaceRef('/local') })
    finish()
    await Promise.resolve()
    expect(loadSessions).not.toHaveBeenCalled()
  })

  it('surfaces a history recovery failure without treating it as an empty successful load', async () => {
    const { listSessions } = installFixture()
    listSessions.mockRejectedValue(new Error('远程会话历史恢复失败：原文件已保留'))
    dispose = installRemoteConversationRestore()
    await vi.waitFor(() =>
      expect(useCclinkStore.getState().error).toContain('远程会话历史恢复失败'),
    )
    expect(useCclinkStore.getState().loading).toBe(false)
  })
})
