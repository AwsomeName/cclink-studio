import type { Command } from '../../stores/command-store'
import { useWorkspaceOpenStore } from '../../features/workspace-open/workspace-open-store'
import {
  openDefaultWorkspace,
  setCurrentWorkspaceAsDefault,
} from '../../features/workspace-open/workspace-open-controller'
import { useFsStore } from '../../stores/fs-store'
import { createOperationsDraft } from '../../features/article-publishing/create-operations-draft'

export function createWorkspaceCommands(): Command[] {
  return [
    {
      id: 'workspace.create-operations-draft',
      label: '新建运营稿',
      category: '工作空间',
      action: createOperationsDraft,
    },
    {
      id: 'workspace.open-default',
      label: '打开默认工作空间',
      category: '工作空间',
      action: openDefaultWorkspace,
    },
    {
      id: 'workspace.set-default',
      label: '将当前工作空间设为默认',
      category: '工作空间',
      action: setCurrentWorkspaceAsDefault,
    },
    {
      id: 'workspace.unfiled',
      label: '进入未归档',
      category: '工作空间',
      action: () => useFsStore.getState().closeWorkspace(),
    },
    {
      id: 'workspace.open',
      label: '打开工作空间',
      category: '工作空间',
      action: () => useWorkspaceOpenStore.getState().show(),
    },
  ]
}
