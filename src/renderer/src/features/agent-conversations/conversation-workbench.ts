import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'

export const CONVERSATION_DRAG_TYPE = 'application/x-cclink-conversation-id'

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
  return Array.from(dataTransfer.types).includes(CONVERSATION_DRAG_TYPE)
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
