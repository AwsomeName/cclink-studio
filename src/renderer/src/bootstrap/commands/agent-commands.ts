import type { Command } from '../../stores/command-store'
import { useAgentStore } from '../../stores/agent-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createConversationRuntimeForWorkspace } from '../../features/agent-conversations/view-model'
import { focusAgentComposer } from '../../features/markdown/markdown-navigation'

export function createAgentCommands(): Command[] {
  return [
    {
      id: 'agent.newConversation',
      label: '新建 Agent 会话',
      category: 'Agent',
      action: async () => {
        const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
        const conversationId = useAgentStore.getState().createConversation({
          runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
          activate: true,
        })
        useUIStore.getState().setAgentPanelMode('right', 'user')
        try {
          await window.cclinkStudio.agent.resetSession(conversationId)
        } finally {
          requestAnimationFrame(focusAgentComposer)
        }
      },
    },
    {
      id: 'agent.resetSession',
      label: '重置 Agent 会话',
      category: 'Agent',
      action: () => {
        const { activeConversationId, clearMessages } = useAgentStore.getState()
        void clearMessages(activeConversationId)
        window.cclinkStudio.agent.resetSession(activeConversationId)
      },
    },
  ]
}
