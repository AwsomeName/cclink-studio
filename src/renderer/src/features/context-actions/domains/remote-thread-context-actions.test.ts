import { beforeEach, describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'
import type { CclinkRemoteSession } from '@shared/cclink'
import { useCclinkStore } from '../../../stores/cclink-store'
import { useTabStore } from '../../../stores/tab-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { CommandContext } from '../context-target'
import { resolveContextMenu } from '../resolve-context-menu'
import {
  createRemoteThreadContextCommands,
  remoteThreadMenuContributions,
} from './remote-thread-context-actions'

const workspaceRef = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/srv/project',
})

function session(status: CclinkRemoteSession['status'] = 'idle'): CclinkRemoteSession {
  return {
    id: 'remote-1',
    name: '远程会话',
    workspaceId: workspaceRef.workspaceId,
    workspacePath: workspaceRef.path,
    serverId: workspaceRef.endpointId,
    status,
    createdAt: 1,
    updatedAt: 2,
    messageCount: 0,
    contextUsage: 0,
  }
}

function context(): CommandContext {
  return {
    source: 'context-menu',
    target: {
      kind: 'remote-thread',
      workspaceKey: workspaceRefKey(workspaceRef)!,
      sessionId: 'remote-1',
      endpointId: workspaceRef.endpointId,
      workspaceId: workspaceRef.workspaceId,
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useTabStore.setState(useTabStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(workspaceRef)
})

describe('remote thread context actions', () => {
  it('shows open, open-in-workbench, and close for an idle remote session', () => {
    useCclinkStore.setState({ sessions: [session()] })

    const result = resolveContextMenu({
      commands: createRemoteThreadContextCommands(),
      contributions: remoteThreadMenuContributions,
      context: context(),
    })

    expect(result.failures).toEqual([])
    expect(result.items.map((item) => [item.label, item.enabled])).toEqual([
      ['打开会话', true],
      ['在中间 Tab 打开', true],
      ['关闭会话', true],
    ])
  })

  it('archives the remote owner and closes every matching Workbench Tab', async () => {
    const setSessionArchived = vi.fn().mockResolvedValue(true)
    useCclinkStore.setState({ sessions: [session()], setSessionArchived })
    useTabStore.setState({
      tabs: [
        {
          id: 'remote-tab',
          type: 'remote-conversation',
          title: '远程会话',
          icon: '☁️',
          workspaceRef,
          remoteConversation: { sessionId: 'remote-1' },
        },
      ],
      activeTabId: 'remote-tab',
    })
    const command = createRemoteThreadContextCommands().find(
      (candidate) => candidate.id === 'remoteAgent.archiveConversation',
    )!

    await command.action(context())

    expect(setSessionArchived).toHaveBeenCalledWith('remote-1', true)
    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('keeps close disabled while the remote task is active', () => {
    useCclinkStore.setState({ sessions: [session('active')] })
    const result = resolveContextMenu({
      commands: createRemoteThreadContextCommands(),
      contributions: remoteThreadMenuContributions,
      context: context(),
    })

    expect(result.items.find((item) => item.label === '关闭会话')).toMatchObject({
      enabled: false,
      disabledReason: '远程任务仍在运行，当前协议不支持可靠停止',
    })
  })
})
