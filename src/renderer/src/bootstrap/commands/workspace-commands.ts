import type { Command } from '../../stores/command-store'
import { useWorkspaceOpenStore } from '../../features/workspace-open/workspace-open-store'

export function createWorkspaceCommands(): Command[] {
  return [
    {
      id: 'workspace.open',
      label: '打开工作空间',
      category: '工作空间',
      action: () => useWorkspaceOpenStore.getState().show(),
    },
  ]
}
