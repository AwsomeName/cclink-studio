import { useAgentStore } from '../../stores/agent-store'
import { useCclinkStore } from '../../stores/cclink-store'
import { useTabStore } from '../../stores/tab-store'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'

export const CONVERSATION_DRAG_TYPE = 'application/x-cclink-conversation-id'
export const REMOTE_CONVERSATION_DRAG_TYPE = 'application/x-cclink-remote-conversation'

export interface RemoteConversationDragData {
  sessionId: string
  workspaceKey: string
}

export function writeConversationDragData(
  dataTransfer: DataTransfer,
  conversationId: string,
): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(CONVERSATION_DRAG_TYPE, conversationId)
}

export function readConversationDragData(dataTransfer: DataTransfer): string | null {
  const conversationId = dataTransfer.getData(CONVERSATION_DRAG_TYPE).trim()
  return conversationId || null
}

export function hasConversationDragData(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types)
  return types.includes(CONVERSATION_DRAG_TYPE) || types.includes(REMOTE_CONVERSATION_DRAG_TYPE)
}

export function writeRemoteConversationDragData(
  dataTransfer: DataTransfer,
  sessionId: string,
  workspaceRef: RemoteWorkspaceRef,
): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(
    REMOTE_CONVERSATION_DRAG_TYPE,
    JSON.stringify({ sessionId, workspaceKey: workspaceRefKey(workspaceRef) }),
  )
}

export function readRemoteConversationDragData(
  dataTransfer: DataTransfer,
): RemoteConversationDragData | null {
  const raw = dataTransfer.getData(REMOTE_CONVERSATION_DRAG_TYPE)
  if (!raw || raw.length > 2_048) return null
  try {
    const value = JSON.parse(raw) as Partial<RemoteConversationDragData>
    if (
      typeof value.sessionId !== 'string' ||
      !value.sessionId.trim() ||
      value.sessionId.length > 256 ||
      typeof value.workspaceKey !== 'string' ||
      !value.workspaceKey.trim() ||
      value.workspaceKey.length > 1_024
    ) {
      return null
    }
    return { sessionId: value.sessionId, workspaceKey: value.workspaceKey }
  } catch {
    return null
  }
}

export function openConversationInWorkbench(conversationId: string): boolean {
  const conversation = useAgentStore.getState().conversations[conversationId]
  if (!conversation || conversation.archivedAt) return false

  useTabStore.getState().openTab({
    type: 'conversation',
    title: conversation.title === '新会话' ? '新工作会话' : conversation.title,
    icon: '🤖',
    workspaceRef: conversation.runtime.workspaceRef,
    conversation: {
      surface: 'workbench-tab',
      runtime: conversation.runtime,
      sessionId: conversation.id,
    },
  })
  return true
}

export function openRemoteConversationInWorkbench(
  sessionId: string,
  workspaceRef: RemoteWorkspaceRef,
): boolean {
  const session = useCclinkStore
    .getState()
    .sessions.find(
      (candidate) =>
        candidate.id === sessionId &&
        candidate.status !== 'archived' &&
        candidate.serverId === workspaceRef.endpointId &&
        candidate.workspaceId === workspaceRef.workspaceId,
    )
  if (!session) return false

  useTabStore.getState().openTab({
    type: 'remote-conversation',
    title: session.name,
    icon: '☁️',
    workspaceRef,
    remoteConversation: { sessionId },
  })
  return true
}
