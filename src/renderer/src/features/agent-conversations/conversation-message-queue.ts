import { workspaceRefKey } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  createConversationRunController,
  isConversationSendPending,
} from './conversation-run-controller'

/** One app-level consumer; views only project the conversation-owned queue. */
export function installConversationMessageQueue(
  createController = (conversationId: string) =>
    createConversationRunController({ conversationId }),
): () => void {
  let disposed = false
  let scheduled = false
  const dispatching = new Set<string>()
  const schedule = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (disposed) return
      const workspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
      for (const conversation of Object.values(useAgentStore.getState().conversations)) {
        const item = conversation.queuedMessages?.[0]
        if (!item || conversation.archivedAt || conversation.runtime.location !== 'local') continue
        if (
          conversation.messageQueuePauseReason ||
          conversation.loading ||
          conversation.contextCompaction.status === 'compacting'
        )
          continue
        if (dispatching.has(conversation.id) || isConversationSendPending(conversation.id)) continue
        if (
          conversation.runtime.workspaceRef &&
          workspaceRefKey(conversation.runtime.workspaceRef) !== workspaceKey
        )
          continue
        dispatching.add(conversation.id)
        void createController(conversation.id)
          .sendQueued(item)
          .then((result) => {
            if (result.status === 'failed')
              useAgentStore.getState().setMessageQueuePauseReason(result.error, conversation.id)
          })
          .catch((error: unknown) => {
            useAgentStore
              .getState()
              .setMessageQueuePauseReason(
                error instanceof Error ? error.message : String(error),
                conversation.id,
              )
          })
          .finally(() => {
            dispatching.delete(conversation.id)
            schedule()
          })
      }
    })
  }
  const unsubscribe = useAgentStore.subscribe(schedule)
  const unsubscribeWorkspace = useWorkspaceStore.subscribe(schedule)
  schedule()
  return () => {
    disposed = true
    unsubscribe()
    unsubscribeWorkspace()
  }
}
