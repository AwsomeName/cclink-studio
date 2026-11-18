import { useAgentStore } from '../../../stores/agent-store'
import { getRunningProjectCounts } from '../../agent-conversations/project-activity'
import { openWorkspaceSettings } from '../../workspace-open/WorkspaceSettingsForm'
import { useFixedSpacesStore, openPersonalSpace } from '../../workspace-open/fixed-spaces-store'
import type { Command } from '../../../stores/command-store'
import { useFsStore } from '../../../stores/fs-store'
import { getProjectCloseSuccessor, useOpenProjectsStore } from '../../../stores/open-projects-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useToastStore } from '../../../components/common/Toast'
import type { CommandContext } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

function projectPath(context?: CommandContext): string | null {
  return context?.target?.kind === 'project' ? context.target.path : null
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
        const isFixed =
          path === fixed?.personal?.workspacePath || path === fixed?.company?.workspacePath
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
        if (path === fixed?.personal?.workspacePath || path === fixed?.company?.workspacePath)
          throw new Error('固定入口不能关闭')
        const running =
          getRunningProjectCounts(useAgentStore.getState().conversations).get(path) ?? 0
        const tasks = await window.cclinkStudio.scheduledTasks?.inspect(path)
        const activeTasks = tasks?.success
          ? tasks.tasks.filter(
              (task) =>
                task.activation.enabled ||
                ['queued', 'running'].includes(task.latestRun?.status ?? ''),
            )
          : []
        if (
          (running || activeTasks.length) &&
          !window.confirm(
            `关闭项目视图不会停止 ${running} 个工作会话及 ${activeTasks.length} 个启用/运行中的定时任务。${activeTasks.map((task) => task.definition.title).join('、')}。可从状态栏“进行中的工作”返回。是否仅关闭视图？`,
          )
        )
          return
        const currentActive = useWorkspaceStore.getState().activeWorkspaceRef
        const projectsStore = useOpenProjectsStore.getState()
        const isActive = currentActive.kind === 'local' && currentActive.path === path
        if (!isActive) {
          projectsStore.removeProject(path)
          return
        }

        const nextPath = getProjectCloseSuccessor(
          projectsStore.openProjectPaths.filter(
            (item) =>
              item !== fixed?.personal?.workspacePath && item !== fixed?.company?.workspacePath,
          ),
          path,
        )
        if (nextPath) {
          if (await activateProject(nextPath)) useOpenProjectsStore.getState().removeProject(path)
          return
        }

        await openPersonalSpace()
        const active = useWorkspaceStore.getState().activeWorkspaceRef
        if (
          active.kind === 'local' &&
          active.path === useFixedSpacesStore.getState().spaces?.personal?.workspacePath
        ) {
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
