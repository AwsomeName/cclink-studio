import type { Command } from '../../stores/command-store'
import { useAgentStore } from '../../stores/agent-store'

export function createAgentCommands(): Command[] {
  return [
    {
      id: 'agent.newConversation',
      label: '新建 Agent 会话',
      category: 'Agent',
      action: () => {
        useAgentStore.getState().createConversation()
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
