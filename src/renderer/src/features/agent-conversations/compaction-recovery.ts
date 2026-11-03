import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useAgentStore } from '../../stores/agent-store'

/** Starts an empty Runtime session through the existing conversation lifecycle. */
export function createCompactionRecoveryConversation(
  conversationId: string,
  workspaceRef: WorkspaceRef,
): string | null {
  const store = useAgentStore.getState()
  const source = store.conversations[conversationId]
  if (
    !source ||
    store.activeConversationId !== conversationId ||
    source.archivedAt ||
    source.loading ||
    source.activeRunId ||
    source.contextCompaction.status !== 'failed' ||
    source.runtime.location !== 'local' ||
    !source.runtime.workspaceRef ||
    workspaceRefKey(source.runtime.workspaceRef) !== workspaceRefKey(workspaceRef)
  ) {
    return null
  }

  const id = store.createConversation({
    activate: false,
    runtime: { ...source.runtime },
    runtimeBinding: source.runtimeBinding,
    roleRef: { ...source.configuration.roleRef },
    mountedSkills: source.mountedSkills.map((skill) => ({ ...skill })),
  })
  store.setScope({ ...source.scope }, id)
  store.addSystemMessage(
    '旧会话已保留，可从会话列表返回查看。新对话没有复制旧历史或附件；请补充简短背景和下一步目标后发送。',
    id,
  )
  store.switchConversation(id)
  return id
}
