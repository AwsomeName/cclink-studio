import type { Command } from '../../../stores/command-store'
import { useCclinkStore } from '../../../stores/cclink-store'
import { useTabStore } from '../../../stores/tab-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import { openRemoteConversationInWorkbench } from '../../agent-conversations/conversation-workbench'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function remoteThreadTarget(context?: CommandContext) {
  return context?.target?.kind === 'remote-thread' ? context.target : null
}

function currentRemoteThread(context?: CommandContext) {
  const target = remoteThreadTarget(context)
  if (!target) return null
  return (
    useCclinkStore
      .getState()
      .sessions.find(
        (session) =>
          session.id === target.sessionId &&
          session.serverId === target.endpointId &&
          session.workspaceId === target.workspaceId,
      ) ?? null
  )
}

function currentRemoteWorkspace(context?: CommandContext) {
  const target = remoteThreadTarget(context)
  const ref = useWorkspaceStore.getState().activeWorkspaceRef
  if (!target || ref.kind !== 'remote' || workspaceRefKey(ref) !== target.workspaceKey) return null
  if (ref.endpointId !== target.endpointId || ref.workspaceId !== target.workspaceId) return null
  return ref
}

export function createRemoteThreadContextCommands(): Command[] {
  return [
    {
      id: 'remoteAgent.openConversation',
      label: '打开会话',
      contextOnly: true,
      category: '远程会话',
      visible: (context) => {
        const session = currentRemoteThread(context)
        return Boolean(session && session.status !== 'archived')
      },
      action: async (context) => {
        const session = currentRemoteThread(context)
        if (!session || session.status === 'archived') throw new Error('远程会话已不存在')
        useCclinkStore.getState().selectSession(session.id)
        await useCclinkStore.getState().loadMessages(session.id)
        useUIStore.getState().setAgentPanelMode('right', 'user')
      },
    },
    {
      id: 'remoteAgent.openConversationInWorkbench',
      label: '在中间 Tab 打开',
      contextOnly: true,
      category: '远程会话',
      visible: (context) => {
        const session = currentRemoteThread(context)
        return Boolean(session && session.status !== 'archived')
      },
      action: (context) => {
        const target = remoteThreadTarget(context)
        const ref = currentRemoteWorkspace(context)
        if (!target || !ref || !openRemoteConversationInWorkbench(target.sessionId, ref)) {
          throw new Error('远程会话已不存在或工作空间已切换')
        }
      },
    },
    {
      id: 'remoteAgent.archiveConversation',
      label: '关闭会话',
      contextOnly: true,
      category: '远程会话',
      risk: 'destructive',
      visible: (context) => {
        const session = currentRemoteThread(context)
        return Boolean(session && session.status !== 'archived')
      },
      enabled: (context) => {
        const session = currentRemoteThread(context)
        return {
          enabled: Boolean(session && session.status !== 'active'),
          reason: session ? '远程任务仍在运行，当前协议不支持可靠停止' : '远程会话已不存在',
        }
      },
      action: async (context) => {
        const session = currentRemoteThread(context)
        if (!session || session.status === 'archived') throw new Error('远程会话已不存在')
        const archived = await useCclinkStore.getState().setSessionArchived(session.id, true)
        if (!archived) {
          throw new Error(useCclinkStore.getState().error || '远程会话关闭失败')
        }
        const tabStore = useTabStore.getState()
        tabStore.tabs
          .filter(
            (tab) =>
              tab.type === 'remote-conversation' &&
              tab.remoteConversation?.sessionId === session.id,
          )
          .forEach((tab) => tabStore.closeTab(tab.id))
      },
    },
  ]
}

export const remoteThreadMenuContributions: MenuContribution[] = [
  {
    id: 'remote-thread.open',
    targetKinds: ['remote-thread'],
    group: '10-open',
    order: 10,
    commandId: 'remoteAgent.openConversation',
  },
  {
    id: 'remote-thread.open-in-workbench',
    targetKinds: ['remote-thread'],
    group: '10-open',
    order: 20,
    commandId: 'remoteAgent.openConversationInWorkbench',
    icon: '▣',
  },
  {
    id: 'remote-thread.archive',
    targetKinds: ['remote-thread'],
    group: '90-manage',
    order: 10,
    commandId: 'remoteAgent.archiveConversation',
    icon: '⌄',
  },
]
