import type { Command } from '../../stores/command-store'
import { useWorkspaceOpenStore } from '../../features/workspace-open/workspace-open-store'
import {
  openDefaultWorkspace,
  setCurrentWorkspaceAsDefault,
} from '../../features/workspace-open/workspace-open-controller'
import { useFsStore } from '../../stores/fs-store'
import { createOperationsDraft } from '../../features/article-publishing/create-operations-draft'
import { createPersonalNote } from '../../features/workspace-open/WorkspaceHome'
import {
  useFixedSpacesStore,
  openPersonalSpace,
} from '../../features/workspace-open/fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openCompanyWorkspace } from '../../features/company-workspace/company-workspace-commands'
import { showWorkspaceHome } from '../../features/workspace-open/workspace-home-navigation'

export function createWorkspaceCommands(): Command[] {
  return [
    {
      id: 'workspace.new-note',
      label: '新建笔记',
      category: '工作空间',
      action: createPersonalNote,
    },
    {
      id: 'workspace.home',
      label: '打开当前工作台',
      category: '工作空间',
      action: () => {
        const ref = useWorkspaceStore.getState().activeWorkspaceRef
        if (ref.kind === 'global') return openPersonalSpace()
        if (
          ref.kind === 'local' &&
          ref.path === useFixedSpacesStore.getState().spaces?.company?.workspacePath
        ) {
          openCompanyWorkspace()
          return
        }
        showWorkspaceHome(ref)
      },
    },
    {
      id: 'workspace.create-operations-draft',
      label: '新建运营稿',
      category: '工作空间',
      action: createOperationsDraft,
    },
    {
      id: 'workspace.open-default',
      label: '打开我的空间',
      category: '工作空间',
      action: openDefaultWorkspace,
    },
    {
      id: 'workspace.set-default',
      label: '将当前工作空间用作我的空间',
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
