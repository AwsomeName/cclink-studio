import { workspaceRefKey } from '@shared/workspace-ref'
import { inspectWorkspaceWork } from '../../running-work/workspace-work'
import { askProjectClose } from '../../running-work/ProjectCloseDialog'
import { useAgentStore } from '../../../stores/agent-store'
import { getRunningProjectCounts } from '../../agent-conversations/project-activity'
import { openWorkspaceSettings } from '../../workspace-open/WorkspaceSettingsForm'
import { useFixedSpacesStore, openPersonalSpace } from '../../workspace-open/fixed-spaces-store'
import type { Command } from '../../../stores/command-store'
import { useFsStore } from '../../../stores/fs-store'
import {
  getProjectCloseSuccessor,
  useOpenProjectsStore,
  workspaceStripGroup,
} from '../../../stores/open-projects-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useToastStore } from '../../../components/common/Toast'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function projectPath(context?: CommandContext): string | null {
  return context?.target?.kind === 'project' ? context.target.path : null
}

function pinnableWorkspaceKey(context?: CommandContext): string | null {
  const target = context?.target
  if (target?.kind === 'remote-workspace' || target?.kind === 'project') return target.workspaceKey
  return null
}

async function activateProject(path: string): Promise<boolean> {
  const active = useWorkspaceStore.getState().activeWorkspaceRef
  if (active.kind === 'local' && active.path === path) return true
  const success = await useFsStore.getState().openRecentWorkspace(path)
  if (!success) {
    const reason = useFsStore.getState().error
    useToastStore.getState().show(reason || '项目切换失败，已保留当前现场', 'error')
  }
  return success
}

async function copyProjectPath(path: string): Promise<void> {
  await navigator.clipboard.writeText(path)
  useToastStore.getState().show('项目路径已复制', 'success')
}

export function createProjectContextCommands(): Command[] {
  return [
    {
      id: 'project.activate',
      label: '切换到项目',
      contextOnly: true,
      category: '项目',
      checked: (context) => {
        const path = projectPath(context)
        const active = useWorkspaceStore.getState().activeWorkspaceRef
        return Boolean(path && active.kind === 'local' && active.path === path)
      },
      enabled: (context) => {
        const path = projectPath(context)
        return {
          enabled: Boolean(path && useOpenProjectsStore.getState().openProjectPaths.includes(path)),
          reason: '项目已关闭',
        }
      },
      action: async (context) => {
        const path = projectPath(context)
        if (!path) throw new Error('项目目标已失效')
        await activateProject(path)
      },
    },
    {
      id: 'workspace.togglePinned',
      label: '固定项目',
      contextOnly: true,
      category: '项目',
      visible: (context) =>
        pinnableWorkspaceKey(context) !==
        useFixedSpacesStore.getState().spaces?.personal?.workspacePath,
      contextLabel: (context) =>
        useOpenProjectsStore
          .getState()
          .pinnedWorkspaceKeys.includes(pinnableWorkspaceKey(context) ?? '')
          ? '解除固定'
          : '固定项目',
      enabled: (context) => {
        const key = pinnableWorkspaceKey(context)
        const state = useOpenProjectsStore.getState()
        return Boolean(
          key &&
          (state.openProjectPaths.includes(key) ||
            state.openRemoteWorkspaceRefs.some((ref) => workspaceRefKey(ref) === key)),
        )
      },
      action: (context) => {
        const key = pinnableWorkspaceKey(context)
        if (key && key !== useFixedSpacesStore.getState().spaces?.personal?.workspacePath)
          useOpenProjectsStore.getState().toggleWorkspacePinned(key)
      },
    },
    {
      id: 'project.settings',
      label: '项目设置',
      contextOnly: true,
      category: '项目',
      action: async (context) => {
        const path = projectPath(context)
        if (!path) throw Error('项目目标已失效')
        if (await activateProject(path)) openWorkspaceSettings()
      },
    },
    {
      id: 'project.copyPath',
      label: '复制项目路径',
      contextOnly: true,
      category: '项目',
      action: (context) => {
        const path = projectPath(context)
        if (!path) throw new Error('项目目标已失效')
        return copyProjectPath(path)
      },
    },
    {
      id: 'project.revealInFileManager',
      label: '在 Finder 中显示',
      contextOnly: true,
      category: '项目',
      action: async (context) => {
        const path = projectPath(context)
        if (!path) throw new Error('项目目标已失效')
        await window.cclinkStudio.fs.revealPath({ workspacePath: path, targetPath: path })
      },
    },
    {
      id: 'project.close',
      label: '关闭项目',
      contextOnly: true,
      category: '项目',
      enabled: (context) => {
        const path = projectPath(context)
        const fixed = useFixedSpacesStore.getState().spaces
        const isFixed = path === fixed?.personal?.workspacePath
        return {
          enabled: Boolean(
            path && !isFixed && useOpenProjectsStore.getState().openProjectPaths.includes(path),
          ),
          reason: isFixed ? '固定入口不能关闭' : '项目已关闭',
        }
      },
      action: async (context) => {
        const path = projectPath(context)
        if (!path) throw new Error('项目目标已失效')
        const fixed = useFixedSpacesStore.getState().spaces
        if (path === fixed?.personal?.workspacePath) throw new Error('固定入口不能关闭')
        const running =
          getRunningProjectCounts(useAgentStore.getState().conversations).get(path) ?? 0
        const work = await inspectWorkspaceWork(path)
        if (
          running ||
          work.tasks.length ||
          work.affairs.length ||
          work.terminals.length ||
          work.errors.length
        ) {
          const name = path.split('/').filter(Boolean).pop() ?? path
          const choice = await askProjectClose(name, running, work)
          if (!choice) return
          if (choice === 'disable-tasks') {
            for (const task of work.tasks.filter((item) => item.activation.enabled)) {
              const result = await window.cclinkStudio.scheduledTasks.setEnabled({
                workspacePath: path,
                taskId: task.definition.id,
                enabled: false,
              })
              if (!result.success)
                throw new Error(
                  `停用「${task.definition.title}」失败：${result.error?.message ?? '未知错误'}，项目未关闭`,
                )
            }
          }
        }
        const currentActive = useWorkspaceStore.getState().activeWorkspaceRef
        const projectsStore = useOpenProjectsStore.getState()
        const isActive = currentActive.kind === 'local' && currentActive.path === path
        if (!isActive) {
          projectsStore.removeProject(path)
          return
        }

        const group = (key: string) => workspaceStripGroup(key, projectsStore.pinnedWorkspaceKeys)
        const visiblePaths = projectsStore.openProjectPaths
          .filter((item) => item !== fixed?.personal?.workspacePath)
          .sort((left, right) => group(left) - group(right))
        const nextPath = getProjectCloseSuccessor(visiblePaths, path)
        if (nextPath) {
          if (await activateProject(nextPath)) useOpenProjectsStore.getState().removeProject(path)
          return
        }

        await openPersonalSpace()
        const active = useWorkspaceStore.getState().activeWorkspaceRef
        const personalPath = useFixedSpacesStore.getState().spaces?.personal?.workspacePath
        if (active.kind === 'local' && active.path === personalPath) {
          useOpenProjectsStore.getState().removeProject(path)
        } else if (!personalPath) {
          // My Space is not set up yet (first use is offered): closing still closes.
          await useFsStore.getState().closeWorkspace()
          useOpenProjectsStore.getState().removeProject(path)
        }
      },
    },
  ]
}

export const projectMenuContributions: MenuContribution[] = [
  {
    id: 'project.settings',
    targetKinds: ['project'],
    group: '10-open',
    order: 20,
    commandId: 'project.settings',
    icon: '⚙',
  },
  {
    id: 'project.activate',
    targetKinds: ['project'],
    group: '10-open',
    order: 10,
    commandId: 'project.activate',
    icon: '✓',
  },
  {
    id: 'workspace.pin',
    targetKinds: ['project', 'remote-workspace'],
    group: '20-edit',
    order: 10,
    commandId: 'workspace.togglePinned',
    icon: '⚑',
  },
  {
    id: 'project.copy-path',
    targetKinds: ['project'],
    group: '40-copy',
    order: 10,
    commandId: 'project.copyPath',
    icon: '📋',
  },
  {
    id: 'project.reveal',
    targetKinds: ['project'],
    group: '40-copy',
    order: 20,
    commandId: 'project.revealInFileManager',
    icon: '↗',
  },
  {
    id: 'project.diagnostics',
    targetKinds: ['project'],
    group: '80-diagnostics',
    order: 10,
    commandId: 'diagnostics.copyWorkspaceState',
    icon: 'ⓘ',
  },
  {
    id: 'project.close',
    targetKinds: ['project'],
    group: '90-manage',
    order: 10,
    commandId: 'project.close',
    icon: '✕',
  },
]
